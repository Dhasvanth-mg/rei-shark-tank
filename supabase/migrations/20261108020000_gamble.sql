-- All-in gamble: a server-verified timing game. The marker position is a pure function of server time,
-- so the client cannot just claim a win. Wager (all cash) is escrowed at start.
alter table games add column if not exists gamble_enabled boolean not null default true;

create table if not exists gambles (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  round int not null,
  wager bigint not null,
  started_at timestamptz not null default clock_timestamp(),
  center numeric not null,
  width numeric not null,
  period_ms int not null,
  status text not null default 'pending',
  pos numeric,
  mult numeric,
  payout bigint,
  unique (player_id, round)
);
alter table gambles enable row level security;
revoke all on gambles from anon, authenticated;

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

create or replace function gamble_start(p_code text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_p players; v_center numeric; v_period int; v_id uuid; v_now timestamptz := clock_timestamp();
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'The high-stakes table opens during market rounds'; end if;
  if not v_g.gamble_enabled then raise exception 'The host turned the gamble off'; end if;
  select * into v_p from players where id = v_pid for update;
  if v_p.cash < 1000 then raise exception 'You need cash on hand to gamble'; end if;
  if exists (select 1 from gambles where player_id = v_pid and round = v_g.round) then
    raise exception 'You already took your shot this round';
  end if;
  v_center := round((0.22 + random() * 0.56)::numeric, 3);
  v_period := 1100 + floor(random() * 500)::int;
  insert into gambles (game_id, player_id, round, wager, started_at, center, width, period_ms)
    values (v_g.id, v_pid, v_g.round, v_p.cash, v_now, v_center, 0.18, v_period) returning id into v_id;
  update players set cash = 0 where id = v_pid;
  perform _recalc(v_g.id, v_pid);
  return jsonb_build_object('wager', v_p.cash, 'center', v_center, 'width', 0.18, 'period_ms', v_period,
    'started_ms', (extract(epoch from v_now) * 1000)::bigint,
    'server_now', (extract(epoch from clock_timestamp()) * 1000)::bigint);
end $$;

create or replace function gamble_finish(p_code text, p_token text, p_client_ms bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_gm gambles; v_now timestamptz := clock_timestamp(); v_tap timestamptz;
  v_el numeric; v_x numeric; v_pos numeric; v_d numeric; v_mult numeric; v_pay bigint;
begin
  v_g := _trade_game(p_code);
  v_pid := _trade_pid(v_g.id, p_token);
  select * into v_gm from gambles where player_id = v_pid and status = 'pending' order by started_at desc limit 1 for update;
  if not found then raise exception 'No gamble in progress'; end if;
  v_tap := v_now;
  if p_client_ms is not null then
    v_tap := least(v_now, greatest(v_now - interval '1500 milliseconds', to_timestamp(p_client_ms / 1000.0)));
  end if;
  v_tap := greatest(v_tap, v_gm.started_at);
  v_el := extract(epoch from v_tap - v_gm.started_at) * 1000;
  if v_el > 25000 then
    v_mult := 0; v_pos := null;
  else
    v_x := mod(v_el, (2 * v_gm.period_ms)::numeric) / v_gm.period_ms;
    v_pos := case when v_x <= 1 then v_x else 2 - v_x end;
    v_d := abs(v_pos - v_gm.center);
    v_mult := case when v_d <= v_gm.width * 0.15 then 3 when v_d <= v_gm.width / 2 then 2 when v_d <= v_gm.width then 0.5 else 0 end;
  end if;
  v_pay := round(v_gm.wager * v_mult);
  update gambles set status = 'done', pos = v_pos, mult = v_mult, payout = v_pay where id = v_gm.id;
  update players set cash = cash + v_pay where id = v_pid;
  perform _recalc(v_g.id, v_pid);
  return jsonb_build_object('pos', v_pos, 'center', v_gm.center, 'width', v_gm.width, 'mult', v_mult, 'wager', v_gm.wager, 'payout', v_pay);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  create_game(text, boolean, jsonb), join_game(text, text, text), update_profile(text, text, text, text),
  game_state(text, text, text), tick(text),
  buy_property(text, text, text), sell_property(text, text, text), borrow(text, text, bigint), repay(text, text, bigint),
  gamble_start(text, text), gamble_finish(text, text, bigint),
  admin_update_settings(text, text, jsonb), admin_update_property(text, text, text, jsonb), admin_add_property(text, text, jsonb),
  admin_create_event(text, text, jsonb), admin_delete_event(text, text, text),
  admin_start_building(text, text), admin_start_round(text, text, text), admin_timer(text, text, text, int),
  admin_finish(text, text), admin_reset_game(text, text), admin_delete_game(text, text),
  admin_update_player(text, text, uuid, jsonb), admin_kick_player(text, text, uuid), admin_reset_player(text, text, uuid),
  admin_player_property(text, text, uuid, text, text), admin_add_bots(text, text, int), admin_clear_bots(text, text)
  to anon, authenticated;
