-- Blackjack (server-side hands, hidden hole card) + friendlier odds across the casino.
-- Rules: infinite deck, dealer stands on ALL 17s, blackjack pays 3:2, double on any two cards,
-- five cards without busting wins (Charlie). Slight edge to the player.
alter table gambles add column if not exists state jsonb;

create or replace function _bj_draw() returns int language sql volatile as $$ select 1 + floor(random() * 13)::int $$;

create or replace function _bj_total(p_cards jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_sum int := 0; v_aces int := 0; v_c int; r jsonb;
begin
  for r in select value from jsonb_array_elements(p_cards) loop
    v_c := (r #>> '{}')::int;
    if v_c = 1 then v_aces := v_aces + 1; v_sum := v_sum + 11;
    elsif v_c >= 10 then v_sum := v_sum + 10;
    else v_sum := v_sum + v_c; end if;
  end loop;
  while v_sum > 21 and v_aces > 0 loop v_sum := v_sum - 10; v_aces := v_aces - 1; end loop;
  return jsonb_build_object('total', v_sum, 'soft', v_aces > 0);
end $$;

create or replace function _bj_view(p_gid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v gambles; pt jsonb; dt jsonb; v_done boolean; v_dealer jsonb;
begin
  select * into v from gambles where id = p_gid;
  v_done := v.status = 'done';
  pt := _bj_total(v.state->'player');
  dt := _bj_total(v.state->'dealer');
  v_dealer := case when v_done then v.state->'dealer' else jsonb_build_array(v.state->'dealer'->0, null) end;
  return jsonb_build_object('wager', v.wager, 'player', v.state->'player', 'player_total', pt->'total', 'soft', pt->'soft',
    'dealer', v_dealer, 'dealer_total', case when v_done then dt->'total' else null end, 'done', v_done,
    'gross', v.payout, 'tax', v.tax, 'net', case when v_done then v.payout - v.wager - v.tax else null end,
    'can_double', (not v_done) and jsonb_array_length(v.state->'player') = 2, 'outcome', v.state->'outcome');
end $$;

create or replace function _bj_finish(p_gid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v gambles; g games; pl jsonb; dl jsonb; pt int; dt int; v_mult numeric; v_out text; v_nat boolean;
  v_gross bigint; v_profit bigint; v_tax bigint := 0;
begin
  select * into v from gambles where id = p_gid for update;
  select * into g from games where id = v.game_id;
  pl := v.state->'player'; dl := v.state->'dealer';
  pt := (_bj_total(pl)->>'total')::int;
  v_nat := jsonb_array_length(pl) = 2 and pt = 21 and not coalesce((v.state->>'doubled')::boolean, false);
  if pt > 21 then
    v_out := 'bust'; v_mult := 0;
  elsif v_nat then
    if jsonb_array_length(dl) = 2 and (_bj_total(dl)->>'total')::int = 21 then v_out := 'push'; v_mult := 1;
    else v_out := 'blackjack'; v_mult := 2.5; end if;
  elsif jsonb_array_length(pl) >= 5 then
    v_out := 'charlie'; v_mult := 2;
  else
    loop
      dt := (_bj_total(dl)->>'total')::int;
      exit when dt >= 17;
      dl := dl || jsonb_build_array(_bj_draw());
    end loop;
    if dt > 21 then v_out := 'dealer_bust'; v_mult := 2;
    elsif pt > dt then v_out := 'win'; v_mult := 2;
    elsif pt = dt then v_out := 'push'; v_mult := 1;
    else v_out := 'lose'; v_mult := 0; end if;
  end if;
  v_gross := round(v.wager * v_mult);
  v_profit := v_gross - v.wager;
  if v_profit > 0 then v_tax := round(v_profit * g.tax_gamble); end if;
  update players set cash = cash + v_gross - v_tax, tax_total = tax_total + v_tax where id = v.player_id;
  update gambles set status = 'done', mult = v_mult, payout = v_gross, tax = v_tax,
    state = v.state || jsonb_build_object('dealer', dl, 'outcome', v_out) where id = p_gid;
  perform _recalc(v.game_id, v.player_id);
end $$;

create or replace function bj_start(p_code text, p_token text, p_fraction numeric default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_p players; v_wager bigint; v_used int; v_gid uuid;
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'The casino opens during market rounds'; end if;
  if not v_g.gamble_enabled then raise exception 'The host closed the casino'; end if;
  if p_fraction not in (0.25, 0.5, 1) then raise exception 'Pick a stake size'; end if;
  select * into v_p from players where id = v_pid for update;
  if exists (select 1 from gambles where player_id = v_pid and status = 'pending') then
    raise exception 'Finish your blackjack hand first';
  end if;
  select count(*) into v_used from gambles where player_id = v_pid and round = v_g.round;
  if v_used >= v_g.gamble_limit then raise exception 'You used all % bets this round', v_g.gamble_limit; end if;
  v_wager := floor(v_p.cash * p_fraction);
  if v_wager < 1000 then raise exception 'Not enough cash to bet that much'; end if;
  update players set cash = cash - v_wager where id = v_pid;
  insert into gambles (game_id, player_id, round, wager, status, kind, pick, state)
    values (v_g.id, v_pid, v_g.round, v_wager, 'pending', 'blackjack', 'bj',
      jsonb_build_object('player', jsonb_build_array(_bj_draw(), _bj_draw()), 'dealer', jsonb_build_array(_bj_draw(), _bj_draw()), 'doubled', false))
    returning id into v_gid;
  perform _recalc(v_g.id, v_pid);
  if (_bj_total((select state->'player' from gambles where id = v_gid))->>'total')::int = 21 then perform _bj_finish(v_gid); end if;
  return _bj_view(v_gid) || jsonb_build_object('left', v_g.gamble_limit - v_used - 1);
end $$;

create or replace function bj_action(p_code text, p_token text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v gambles; v_p players; v_cards jsonb; v_total int;
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  select * into v_p from players where id = v_pid for update;
  select * into v from gambles where player_id = v_pid and status = 'pending' and kind = 'blackjack' order by round desc limit 1 for update;
  if not found then raise exception 'No blackjack hand in progress'; end if;
  v_cards := v.state->'player';
  if p_action = 'hit' then
    v_cards := v_cards || jsonb_build_array(_bj_draw());
    update gambles set state = state || jsonb_build_object('player', v_cards) where id = v.id;
    v_total := (_bj_total(v_cards)->>'total')::int;
    if v_total >= 21 or jsonb_array_length(v_cards) >= 5 then perform _bj_finish(v.id); end if;
  elsif p_action = 'stand' then
    perform _bj_finish(v.id);
  elsif p_action = 'double' then
    if jsonb_array_length(v_cards) <> 2 then raise exception 'You can only double on your first move'; end if;
    if v_p.cash < v.wager then raise exception 'Not enough cash to double'; end if;
    update players set cash = cash - v.wager where id = v_pid;
    v_cards := v_cards || jsonb_build_array(_bj_draw());
    update gambles set wager = wager * 2, state = state || jsonb_build_object('player', v_cards, 'doubled', true) where id = v.id;
    perform _bj_finish(v.id);
  else
    raise exception 'Unknown action';
  end if;
  perform _recalc(v_g.id, v_pid);
  return _bj_view(v.id);
end $$;

create or replace function bj_state(p_code text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_id uuid;
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  select id into v_id from gambles where player_id = v_pid and status = 'pending' and kind = 'blackjack' order by round desc limit 1;
  if v_id is null then return null; end if;
  return _bj_view(v_id);
end $$;

-- Friendlier odds: zero is a push on red/black, lucky number pays 40x, dice hit more often.
create or replace function gamble_play(p_code text, p_token text, p_game text, p_pick text, p_fraction numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g games; v_pid uuid; v_p players; v_wager bigint; v_win boolean := false; v_push boolean := false; v_mult numeric := 0;
  v_spin int; v_roll int; v_color text; v_gross bigint; v_profit bigint; v_tax bigint := 0; v_used int; v_need int;
  v_reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'The casino opens during market rounds'; end if;
  if not v_g.gamble_enabled then raise exception 'The host closed the casino'; end if;
  if p_fraction not in (0.25, 0.5, 1) then raise exception 'Pick a stake size'; end if;
  select * into v_p from players where id = v_pid for update;
  if exists (select 1 from gambles where player_id = v_pid and status = 'pending') then
    raise exception 'Finish your blackjack hand first';
  end if;
  select count(*) into v_used from gambles where player_id = v_pid and round = v_g.round;
  if v_used >= v_g.gamble_limit then raise exception 'You used all % bets this round', v_g.gamble_limit; end if;
  v_wager := floor(v_p.cash * p_fraction);
  if v_wager < 1000 then raise exception 'Not enough cash to bet that much'; end if;

  if p_game = 'color' then
    if p_pick not in ('red', 'black') then raise exception 'Pick red or black'; end if;
    v_spin := floor(random() * 37)::int;
    v_color := case when v_spin = 0 then 'green' when v_spin = any (v_reds) then 'red' else 'black' end;
    v_win := v_color = p_pick; v_mult := 2;
    if v_color = 'green' then v_push := true; end if;
  elsif p_game = 'number' then
    if p_pick !~ '^\d{1,2}$' or p_pick::int > 36 then raise exception 'Pick a number from 0 to 36'; end if;
    v_spin := floor(random() * 37)::int;
    v_color := case when v_spin = 0 then 'green' when v_spin = any (v_reds) then 'red' else 'black' end;
    v_win := v_spin = p_pick::int; v_mult := 40;
  elsif p_game = 'dice' then
    if p_pick not in ('2x', '3x', '10x') then raise exception 'Pick a multiplier'; end if;
    v_roll := 1 + floor(random() * 100)::int;
    v_need := case p_pick when '2x' then 49 when '3x' then 66 else 90 end;
    v_mult := case p_pick when '2x' then 2 when '3x' then 3 else 10 end;
    v_win := v_roll >= v_need;
  else
    raise exception 'Unknown game';
  end if;

  v_gross := case when v_win then round(v_wager * v_mult) when v_push then v_wager else 0 end;
  v_profit := v_gross - v_wager;
  if v_profit > 0 then v_tax := round(v_profit * v_g.tax_gamble); end if;

  update players set cash = cash - v_wager + v_gross - v_tax, tax_total = tax_total + v_tax where id = v_pid;
  insert into gambles (game_id, player_id, round, wager, status, kind, pick, spin, mult, payout, tax)
    values (v_g.id, v_pid, v_g.round, v_wager, 'done', p_game, p_pick, coalesce(v_spin, v_roll), case when v_win then v_mult else 0 end, v_gross, v_tax);
  perform _recalc(v_g.id, v_pid);
  return jsonb_build_object('game', p_game, 'pick', p_pick, 'spin', v_spin, 'roll', v_roll, 'color', v_color, 'win', v_win, 'push', v_push,
    'wager', v_wager, 'gross', v_gross, 'tax', v_tax, 'net', v_gross - v_wager - v_tax, 'left', v_g.gamble_limit - v_used - 1);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  create_game(text, boolean, jsonb), join_game(text, text, text), update_profile(text, text, text, text),
  game_state(text, text, text), tick(text),
  buy_property(text, text, text), sell_property(text, text, text), borrow(text, text, bigint), repay(text, text, bigint),
  gamble_play(text, text, text, text, numeric), bj_start(text, text, numeric), bj_action(text, text, text), bj_state(text, text),
  admin_update_settings(text, text, jsonb), admin_update_property(text, text, text, jsonb), admin_add_property(text, text, jsonb),
  admin_create_event(text, text, jsonb), admin_delete_event(text, text, text),
  admin_start_building(text, text), admin_start_round(text, text, text), admin_timer(text, text, text, int),
  admin_finish(text, text), admin_reset_game(text, text), admin_delete_game(text, text),
  admin_update_player(text, text, uuid, jsonb), admin_kick_player(text, text, uuid), admin_reset_player(text, text, uuid),
  admin_player_property(text, text, uuid, text, text), admin_add_bots(text, text, int), admin_clear_bots(text, text)
  to anon, authenticated;
