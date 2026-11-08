-- More gambling (color, lucky number, dice ladder) with stake sizes, plus taxes on earnings
-- (rent, property-sale gains, and a much higher rate on gambling winnings).
alter table games add column if not exists tax_rent numeric not null default 0.20;
alter table games add column if not exists tax_gains numeric not null default 0.15;
alter table games add column if not exists tax_gamble numeric not null default 0.40;
alter table games add column if not exists gamble_limit int not null default 3;
alter table players add column if not exists tax_total bigint not null default 0;

alter table gambles drop constraint if exists gambles_player_id_round_key;
alter table gambles add column if not exists kind text;
alter table gambles add column if not exists tax bigint not null default 0;
drop function if exists gamble_spin(text, text, text);

create or replace function _apply_settings(p_game uuid, p_s jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_new bigint;
begin
  select * into v_g from games where id = p_game for update;
  v_new := greatest(1000, coalesce((p_s->>'starting_cash')::bigint, v_g.starting_cash));
  update games set
    name = coalesce(nullif(left(trim(p_s->>'name'), 60), ''), name),
    total_rounds = greatest(v_g.round, least(10, greatest(1, coalesce((p_s->>'total_rounds')::int, total_rounds)))),
    build_seconds = least(3600, greatest(10, coalesce((p_s->>'build_seconds')::int, build_seconds))),
    round_seconds = least(3600, greatest(10, coalesce((p_s->>'round_seconds')::int, round_seconds))),
    starting_cash = v_new,
    fee_rate = least(0.25, greatest(0, coalesce((p_s->>'fee_rate')::numeric, fee_rate))),
    loan_rate = least(0.5, greatest(0, coalesce((p_s->>'loan_rate')::numeric, loan_rate))),
    loan_penalty_rate = least(1, greatest(0, coalesce((p_s->>'loan_penalty_rate')::numeric, loan_penalty_rate))),
    loan_cheap_limit = greatest(0, coalesce((p_s->>'loan_cheap_limit')::bigint, loan_cheap_limit)),
    max_debt = greatest(0, coalesce((p_s->>'max_debt')::bigint, max_debt)),
    volatility = least(5, greatest(0, coalesce((p_s->>'volatility')::numeric, volatility))),
    rent_months = least(24, greatest(1, coalesce((p_s->>'rent_months')::int, rent_months))),
    tax_rent = least(0.9, greatest(0, coalesce((p_s->>'tax_rent')::numeric, tax_rent))),
    tax_gains = least(0.9, greatest(0, coalesce((p_s->>'tax_gains')::numeric, tax_gains))),
    tax_gamble = least(0.95, greatest(0, coalesce((p_s->>'tax_gamble')::numeric, tax_gamble))),
    gamble_limit = least(20, greatest(1, coalesce((p_s->>'gamble_limit')::int, gamble_limit))),
    scarcity = coalesce((p_s->>'scarcity')::boolean, scarcity),
    gamble_enabled = coalesce((p_s->>'gamble_enabled')::boolean, gamble_enabled),
    trading_locked = coalesce((p_s->>'trading_locked')::boolean, trading_locked),
    leaderboard_hidden = coalesce((p_s->>'leaderboard_hidden')::boolean, leaderboard_hidden)
  where id = p_game;
  if p_s ? 'event_plan' then
    update game_secrets set event_plan = coalesce(p_s->'event_plan', '{}'::jsonb) where game_id = p_game;
  end if;
  if v_g.phase = 'lobby' and v_new <> v_g.starting_cash then
    update players set cash = cash + (v_new - v_g.starting_cash) where game_id = p_game;
    perform _recalc(p_game);
  end if;
end $$;

-- Selling a property above what you paid triggers capital-gains tax.
create or replace function _do_sell(p_g games, p_pid uuid, p_prop text) returns void
language plpgsql security definer set search_path = public as $$
declare v_gp game_properties; v_fee bigint; v_buy bigint; v_tax bigint := 0;
begin
  perform 1 from players where id = p_pid for update;
  select purchase_price into v_buy from holdings where player_id = p_pid and property_id = p_prop;
  if not found then raise exception 'You do not own this property'; end if;
  select * into v_gp from game_properties where game_id = p_g.id and property_id = p_prop;
  v_fee := case when p_g.phase = 'round' then round(v_gp.current_value * p_g.fee_rate) else 0 end;
  if v_gp.current_value > v_buy then v_tax := round((v_gp.current_value - v_buy) * p_g.tax_gains); end if;
  delete from holdings where player_id = p_pid and property_id = p_prop;
  update players set cash = cash + v_gp.current_value - v_fee - v_tax,
    expense_total = expense_total + v_fee, tax_total = tax_total + v_tax where id = p_pid;
  perform _recalc(p_g.id, p_pid);
end $$;

create or replace function _settle(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_g games; v_ev market_events; v_t text; v_e jsonb; v_rolls jsonb := '{}'; v_gp record; v_changes jsonb := '[]';
  v_noise numeric; v_vp numeric; v_rp numeric; v_mp numeric; v_roll jsonb; v_vol numeric; v_pl record;
  v_inc bigint; v_exp bigint; v_int bigint; v_tax bigint; v_newval bigint; v_loan numeric;
begin
  select * into v_g from games where id = p_game for update;
  if v_g.phase <> 'round' then return; end if;
  select * into v_ev from market_events where id = v_g.event_id;
  v_loan := least(0.25, greatest(0, v_g.loan_rate + coalesce(v_ev.loan_rate_delta, 0)));

  for v_t in select distinct type from game_properties where game_id = p_game loop
    v_e := _effect_for(coalesce(v_ev.effects, '{}'::jsonb), v_t);
    v_rolls := v_rolls || jsonb_build_object(v_t, jsonb_build_object(
      'v', _roll((v_e->'v'->>0)::numeric, (v_e->'v'->>1)::numeric),
      'r', _roll((v_e->'r'->>0)::numeric, (v_e->'r'->>1)::numeric),
      'm', _roll((v_e->'m'->>0)::numeric, (v_e->'m'->>1)::numeric)));
  end loop;

  for v_gp in select * from game_properties where game_id = p_game loop
    v_roll := v_rolls->v_gp.type;
    v_vol := case v_gp.risk when 'low' then 1.5 when 'medium' then 3.5 else 7 end * v_g.volatility;
    v_noise := (random() * 2 - 1) * v_vol;
    v_vp := coalesce((v_roll->>'v')::numeric, 0) + v_noise;
    v_rp := coalesce((v_roll->>'r')::numeric, 0) + v_noise * 0.3;
    v_mp := coalesce((v_roll->>'m')::numeric, 0);
    v_newval := greatest(10000, round(v_gp.current_value * (1 + v_vp / 100) / 1000) * 1000);
    update game_properties set current_value = v_newval,
      monthly_rent = case when monthly_rent = 0 then 0 else greatest(0, round(monthly_rent * (1 + v_rp / 100) / 10) * 10) end
      where game_id = p_game and property_id = v_gp.property_id;
    v_changes := v_changes || jsonb_build_object('property_id', v_gp.property_id,
      'old_value', v_gp.current_value, 'new_value', v_newval,
      'value_pct', round(v_vp, 1), 'rent_pct', round(v_rp, 1), 'maint_pct', round(v_mp));
  end loop;

  for v_pl in select * from players where game_id = p_game for update loop
    select coalesce(sum(gp.monthly_rent::bigint * v_g.rent_months), 0)::bigint,
           coalesce(sum(round(gp.current_value * gp.maintenance_rate * (1 + coalesce((v_rolls->gp.type->>'m')::numeric, 0) / 100))), 0)::bigint
      into v_inc, v_exp
      from holdings h join game_properties gp on gp.game_id = h.game_id and gp.property_id = h.property_id
      where h.player_id = v_pl.id;
    v_int := round(least(v_pl.debt, v_g.loan_cheap_limit) * v_loan
                 + greatest(v_pl.debt - v_g.loan_cheap_limit, 0) * v_g.loan_penalty_rate);
    -- income tax on rent collected (before repairs, like a gross-receipts tax)
    v_tax := round(v_inc * v_g.tax_rent);
    update players set cash = cash + v_inc - v_exp - v_int - v_tax,
      rent_total = rent_total + v_inc, expense_total = expense_total + v_exp + v_int, tax_total = tax_total + v_tax
      where id = v_pl.id;
    insert into round_results (game_id, round, player_id, rent_income, expenses)
      values (p_game, v_g.round, v_pl.id, v_inc, v_exp + v_int + v_tax)
      on conflict (game_id, round, player_id) do update set rent_income = excluded.rent_income, expenses = excluded.expenses;
  end loop;

  update players set debt = debt - cash, cash = 0 where game_id = p_game and cash < 0;
  perform _recalc(p_game);
  perform _rank_results(p_game, v_g.round);

  insert into round_log (game_id, round, event, changes, loan_rate)
    values (p_game, v_g.round, jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'emoji', v_ev.emoji,
      'headline', v_ev.headline, 'description', v_ev.description), v_changes, v_loan)
    on conflict (game_id, round) do update set event = excluded.event, changes = excluded.changes, loan_rate = excluded.loan_rate;

  update games set phase = 'round_end', ends_at = null, paused = false, paused_remaining = null, loan_rate = v_loan
    where id = p_game;
end $$;

create or replace function admin_reset_game(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from holdings where game_id = v_g.id;
  delete from gambles where game_id = v_g.id;
  delete from round_results where game_id = v_g.id;
  delete from round_log where game_id = v_g.id;
  update game_properties set current_value = base_price, monthly_rent = base_rent where game_id = v_g.id;
  update players set cash = v_g.starting_cash, debt = 0, rent_total = 0, expense_total = 0, tax_total = 0, net_worth = v_g.starting_cash where game_id = v_g.id;
  update games set phase = 'lobby', round = 0, event_id = null, ends_at = null, paused = false, paused_remaining = null where id = v_g.id;
end $$;

create or replace function admin_reset_player(p_code text, p_pass text, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from holdings where player_id = p_player and game_id = v_g.id;
  update players set cash = v_g.starting_cash, debt = 0, rent_total = 0, expense_total = 0, tax_total = 0 where id = p_player and game_id = v_g.id;
  perform _recalc(v_g.id, p_player);
end $$;

-- p_game: 'color' (pick red|black, 2x), 'number' (pick 0-36, 36x), 'dice' (pick 2x|3x|10x on a d100)
create or replace function gamble_play(p_code text, p_token text, p_game text, p_pick text, p_fraction numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g games; v_pid uuid; v_p players; v_wager bigint; v_win boolean := false; v_mult numeric := 0; v_spin int; v_roll int;
  v_color text; v_gross bigint; v_profit bigint; v_tax bigint := 0; v_used int; v_need int;
  v_reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'The casino opens during market rounds'; end if;
  if not v_g.gamble_enabled then raise exception 'The host closed the casino'; end if;
  if p_fraction not in (0.25, 0.5, 1) then raise exception 'Pick a stake size'; end if;
  select * into v_p from players where id = v_pid for update;
  select count(*) into v_used from gambles where player_id = v_pid and round = v_g.round;
  if v_used >= v_g.gamble_limit then raise exception 'You used all % bets this round', v_g.gamble_limit; end if;
  v_wager := floor(v_p.cash * p_fraction);
  if v_wager < 1000 then raise exception 'Not enough cash to bet that much'; end if;

  if p_game = 'color' then
    if p_pick not in ('red', 'black') then raise exception 'Pick red or black'; end if;
    v_spin := floor(random() * 37)::int;
    v_color := case when v_spin = 0 then 'green' when v_spin = any (v_reds) then 'red' else 'black' end;
    v_win := v_color = p_pick; v_mult := 2;
  elsif p_game = 'number' then
    if p_pick !~ '^\d{1,2}$' or p_pick::int > 36 then raise exception 'Pick a number from 0 to 36'; end if;
    v_spin := floor(random() * 37)::int;
    v_color := case when v_spin = 0 then 'green' when v_spin = any (v_reds) then 'red' else 'black' end;
    v_win := v_spin = p_pick::int; v_mult := 36;
  elsif p_game = 'dice' then
    if p_pick not in ('2x', '3x', '10x') then raise exception 'Pick a multiplier'; end if;
    v_roll := 1 + floor(random() * 100)::int;
    v_need := case p_pick when '2x' then 52 when '3x' then 68 else 91 end;
    v_mult := case p_pick when '2x' then 2 when '3x' then 3 else 10 end;
    v_win := v_roll >= v_need;
  else
    raise exception 'Unknown game';
  end if;

  v_gross := case when v_win then round(v_wager * v_mult) else 0 end;
  v_profit := v_gross - v_wager;
  if v_profit > 0 then v_tax := round(v_profit * v_g.tax_gamble); end if;

  update players set cash = cash - v_wager + v_gross - v_tax, tax_total = tax_total + v_tax where id = v_pid;
  insert into gambles (game_id, player_id, round, wager, status, kind, pick, spin, mult, payout, tax)
    values (v_g.id, v_pid, v_g.round, v_wager, 'done', p_game, p_pick, coalesce(v_spin, v_roll), case when v_win then v_mult else 0 end, v_gross, v_tax);
  perform _recalc(v_g.id, v_pid);
  return jsonb_build_object('game', p_game, 'pick', p_pick, 'spin', v_spin, 'roll', v_roll, 'color', v_color, 'win', v_win,
    'wager', v_wager, 'gross', v_gross, 'tax', v_tax, 'net', v_gross - v_wager - v_tax, 'left', v_g.gamble_limit - v_used - 1);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  create_game(text, boolean, jsonb), join_game(text, text, text), update_profile(text, text, text, text),
  game_state(text, text, text), tick(text),
  buy_property(text, text, text), sell_property(text, text, text), borrow(text, text, bigint), repay(text, text, bigint),
  gamble_play(text, text, text, text, numeric),
  admin_update_settings(text, text, jsonb), admin_update_property(text, text, text, jsonb), admin_add_property(text, text, jsonb),
  admin_create_event(text, text, jsonb), admin_delete_event(text, text, text),
  admin_start_building(text, text), admin_start_round(text, text, text), admin_timer(text, text, text, int),
  admin_finish(text, text), admin_reset_game(text, text), admin_delete_game(text, text),
  admin_update_player(text, text, uuid, jsonb), admin_kick_player(text, text, uuid), admin_reset_player(text, text, uuid),
  admin_player_property(text, text, uuid, text, text), admin_add_bots(text, text, int), admin_clear_bots(text, text)
  to anon, authenticated;
