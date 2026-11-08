-- Roulette (all on red/black) replaces the timing game; tiered loans (cheap first chunk, brutal after).
alter table games add column if not exists loan_cheap_limit bigint not null default 100000;
alter table games add column if not exists loan_penalty_rate numeric not null default 0.30;

alter table gambles alter column center drop not null;
alter table gambles alter column width drop not null;
alter table gambles alter column period_ms drop not null;
alter table gambles add column if not exists pick text;
alter table gambles add column if not exists spin int;

drop function if exists gamble_start(text, text);
drop function if exists gamble_finish(text, text, bigint);

create or replace function gamble_spin(p_code text, p_token text, p_color text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_p players; v_spin int; v_color text; v_win boolean; v_pay bigint;
  v_reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if p_color not in ('red', 'black') then raise exception 'Pick red or black'; end if;
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'The table opens during market rounds'; end if;
  if not v_g.gamble_enabled then raise exception 'The host closed the table'; end if;
  select * into v_p from players where id = v_pid for update;
  if v_p.cash < 1000 then raise exception 'You need cash on hand to gamble'; end if;
  if exists (select 1 from gambles where player_id = v_pid and round = v_g.round) then
    raise exception 'You already spun this round';
  end if;
  v_spin := floor(random() * 37)::int;
  v_color := case when v_spin = 0 then 'green' when v_spin = any (v_reds) then 'red' else 'black' end;
  v_win := v_color = p_color;
  v_pay := case when v_win then v_p.cash * 2 else 0 end;
  insert into gambles (game_id, player_id, round, wager, status, pick, spin, mult, payout)
    values (v_g.id, v_pid, v_g.round, v_p.cash, 'done', p_color, v_spin, case when v_win then 2 else 0 end, v_pay);
  update players set cash = v_pay where id = v_pid;
  perform _recalc(v_g.id, v_pid);
  return jsonb_build_object('spin', v_spin, 'color', v_color, 'pick', p_color, 'win', v_win, 'wager', v_p.cash, 'payout', v_pay);
end $$;

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

create or replace function _settle(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_g games; v_ev market_events; v_t text; v_e jsonb; v_rolls jsonb := '{}'; v_gp record; v_changes jsonb := '[]';
  v_noise numeric; v_vp numeric; v_rp numeric; v_mp numeric; v_roll jsonb; v_vol numeric; v_pl record;
  v_inc bigint; v_exp bigint; v_int bigint; v_newval bigint; v_loan numeric;
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
    -- first chunk of debt at the base rate, everything above it at the penalty rate
    v_int := round(least(v_pl.debt, v_g.loan_cheap_limit) * v_loan
                 + greatest(v_pl.debt - v_g.loan_cheap_limit, 0) * v_g.loan_penalty_rate);
    update players set cash = cash + v_inc - v_exp - v_int,
      rent_total = rent_total + v_inc, expense_total = expense_total + v_exp + v_int where id = v_pl.id;
    insert into round_results (game_id, round, player_id, rent_income, expenses)
      values (p_game, v_g.round, v_pl.id, v_inc, v_exp + v_int)
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

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  create_game(text, boolean, jsonb), join_game(text, text, text), update_profile(text, text, text, text),
  game_state(text, text, text), tick(text),
  buy_property(text, text, text), sell_property(text, text, text), borrow(text, text, bigint), repay(text, text, bigint),
  gamble_spin(text, text, text),
  admin_update_settings(text, text, jsonb), admin_update_property(text, text, text, jsonb), admin_add_property(text, text, jsonb),
  admin_create_event(text, text, jsonb), admin_delete_event(text, text, text),
  admin_start_building(text, text), admin_start_round(text, text, text), admin_timer(text, text, text, int),
  admin_finish(text, text), admin_reset_game(text, text), admin_delete_game(text, text),
  admin_update_player(text, text, uuid, jsonb), admin_kick_player(text, text, uuid), admin_reset_player(text, text, uuid),
  admin_player_property(text, text, uuid, text, text), admin_add_bots(text, text, int), admin_clear_bots(text, text)
  to anon, authenticated;
