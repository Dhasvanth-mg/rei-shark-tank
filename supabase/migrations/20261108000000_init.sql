-- REI Shark Tank: Real Estate Investor game
-- All game logic lives in security-definer RPCs. Clients only SELECT public tables
-- (no secrets) and call RPCs with a player token or admin passcode.

-- ============================================================ TABLES
create table property_catalog (
  id text primary key,
  name text not null,
  label text not null,
  location text not null,
  type text not null,
  description text not null,
  highlight text not null,
  price bigint not null,
  rent int not null,
  risk text not null,
  maintenance_rate numeric not null,
  sort int not null
);

create table market_events (
  id text primary key,
  game_id uuid,
  title text not null,
  emoji text not null,
  headline text not null,
  description text not null,
  effects jsonb not null default '{}',
  loan_rate_delta numeric not null default 0
);

create table games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null default 'Real Estate Shark Tank',
  solo boolean not null default false,
  phase text not null default 'lobby' check (phase in ('lobby','building','round','round_end','finished')),
  round int not null default 0,
  total_rounds int not null default 3,
  build_seconds int not null default 90,
  round_seconds int not null default 180,
  starting_cash bigint not null default 1000000,
  fee_rate numeric not null default 0.02,
  loan_rate numeric not null default 0.08,
  max_debt bigint not null default 250000,
  volatility numeric not null default 1,
  rent_months int not null default 12,
  scarcity boolean not null default false,
  trading_locked boolean not null default false,
  leaderboard_hidden boolean not null default false,
  paused boolean not null default false,
  paused_remaining int,
  ends_at timestamptz,
  event_id text,
  created_at timestamptz not null default now()
);

create table game_secrets (
  game_id uuid primary key references games(id) on delete cascade,
  admin_pass text not null,
  event_plan jsonb not null default '{}'
);

create table game_properties (
  game_id uuid not null references games(id) on delete cascade,
  property_id text not null,
  name text not null,
  label text not null,
  location text not null,
  type text not null,
  description text not null,
  highlight text not null,
  base_price bigint not null,
  current_value bigint not null,
  base_rent int not null,
  monthly_rent int not null,
  risk text not null,
  maintenance_rate numeric not null,
  supply int,
  enabled boolean not null default true,
  sort int not null default 0,
  primary key (game_id, property_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  nickname text not null,
  emoji text not null default '🦈',
  cash bigint not null,
  debt bigint not null default 0,
  rent_total bigint not null default 0,
  expense_total bigint not null default 0,
  net_worth bigint not null,
  is_bot boolean not null default false,
  joined_at timestamptz not null default now()
);
create unique index players_nick_uq on players (game_id, lower(nickname));

create table player_secrets (
  player_id uuid primary key references players(id) on delete cascade,
  token text not null unique
);

create table holdings (
  player_id uuid not null references players(id) on delete cascade,
  game_id uuid not null,
  property_id text not null,
  purchase_price bigint not null,
  bought_round int not null default 0,
  primary key (player_id, property_id),
  foreign key (game_id, property_id) references game_properties(game_id, property_id) on delete cascade
);
create index holdings_prop_idx on holdings (game_id, property_id);

create table round_log (
  game_id uuid not null references games(id) on delete cascade,
  round int not null,
  event jsonb not null,
  changes jsonb not null,
  loan_rate numeric not null,
  settled_at timestamptz not null default now(),
  primary key (game_id, round)
);

create table round_results (
  game_id uuid not null references games(id) on delete cascade,
  round int not null,
  player_id uuid not null references players(id) on delete cascade,
  net_worth bigint not null default 0,
  cash bigint not null default 0,
  debt bigint not null default 0,
  rent_income bigint not null default 0,
  expenses bigint not null default 0,
  rank int not null default 0,
  primary key (game_id, round, player_id)
);

-- ============================================================ SECURITY
alter table property_catalog enable row level security;
alter table market_events enable row level security;
alter table games enable row level security;
alter table game_secrets enable row level security;
alter table game_properties enable row level security;
alter table players enable row level security;
alter table player_secrets enable row level security;
alter table holdings enable row level security;
alter table round_log enable row level security;
alter table round_results enable row level security;

create policy "public read" on games for select using (true);
create policy "public read" on game_properties for select using (true);
create policy "public read" on players for select using (true);
create policy "public read" on round_results for select using (true);
create policy "public read" on round_log for select using (true);

revoke all on all tables in schema public from anon, authenticated;
grant select on games, game_properties, players, round_results, round_log to anon, authenticated;

-- ============================================================ HELPERS
create or replace function _rand_str(p_n int, p_alphabet text) returns text
language plpgsql set search_path = public as $$
declare v_bytes bytea := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
        v_out text := ''; i int;
begin
  for i in 0..p_n - 1 loop
    v_out := v_out || substr(p_alphabet, (get_byte(v_bytes, i) % length(p_alphabet)) + 1, 1);
  end loop;
  return v_out;
end $$;

create or replace function _types() returns text[] language sql immutable as $$
  select array['student','residential','luxury','retail','office','industrial','vacation','land','fixer'];
$$;

create or replace function _effect_for(p_effects jsonb, p_type text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_a jsonb := coalesce(p_effects->'all', '{}'); v_b jsonb := coalesce(p_effects->p_type, '{}');
        v_k text; v_out jsonb := '{}';
begin
  foreach v_k in array array['v','r','m'] loop
    v_out := v_out || jsonb_build_object(v_k, jsonb_build_array(
      coalesce((v_a->v_k->>0)::numeric, 0) + coalesce((v_b->v_k->>0)::numeric, 0),
      coalesce((v_a->v_k->>1)::numeric, 0) + coalesce((v_b->v_k->>1)::numeric, 0)));
  end loop;
  return v_out;
end $$;

create or replace function _lvl(p_x numeric, p_lo numeric, p_hi numeric) returns int
language sql immutable as $$
  select case when abs(p_x) < p_lo then 0 when abs(p_x) < p_hi then 1 else 2 end * sign(p_x)::int;
$$;

create or replace function _event_hints(p_effects jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_t text; v_e jsonb; v_out jsonb := '[]';
begin
  foreach v_t in array _types() loop
    v_e := _effect_for(p_effects, v_t);
    v_out := v_out || jsonb_build_object('type', v_t,
      'v', _lvl(((v_e->'v'->>0)::numeric + (v_e->'v'->>1)::numeric) / 2, 1.5, 7),
      'r', _lvl(((v_e->'r'->>0)::numeric + (v_e->'r'->>1)::numeric) / 2, 1.5, 7),
      'm', _lvl(((v_e->'m'->>0)::numeric + (v_e->'m'->>1)::numeric) / 2, 8, 45));
  end loop;
  return v_out;
end $$;

create or replace function _roll(p_lo numeric, p_hi numeric) returns numeric
language sql volatile as $$ select p_lo + random() * (p_hi - p_lo); $$;

create or replace function _recalc(p_game uuid, p_player uuid default null) returns void
language sql set search_path = public as $$
  update players p set net_worth = p.cash - p.debt + coalesce((
    select sum(gp.current_value) from holdings h
    join game_properties gp on gp.game_id = h.game_id and gp.property_id = h.property_id
    where h.player_id = p.id), 0)
  where p.game_id = p_game and (p_player is null or p.id = p_player);
$$;

create or replace function _admin(p_code text, p_pass text) returns games
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Game not found'; end if;
  if not exists (select 1 from game_secrets s where s.game_id = v_g.id and s.admin_pass = upper(trim(coalesce(p_pass, '')))) then
    raise exception 'Invalid admin passcode';
  end if;
  return v_g;
end $$;

create or replace function _trading_ok(p_g games) returns void
language plpgsql set search_path = public as $$
begin
  if p_g.phase not in ('building', 'round') then raise exception 'Trading is closed right now'; end if;
  if p_g.trading_locked then raise exception 'The host has locked trading'; end if;
  if p_g.paused then raise exception 'The game is paused'; end if;
  if p_g.ends_at is not null and now() > p_g.ends_at + interval '1 second' then
    raise exception 'Time is up for this phase';
  end if;
end $$;

create or replace function _do_buy(p_g games, p_pid uuid, p_prop text) returns void
language plpgsql security definer set search_path = public as $$
declare v_gp game_properties; v_fee bigint; v_cost bigint; v_cash bigint;
begin
  select * into v_gp from game_properties where game_id = p_g.id and property_id = p_prop for update;
  if not found or not v_gp.enabled then raise exception 'That property is not on the market'; end if;
  if exists (select 1 from holdings where player_id = p_pid and property_id = p_prop) then
    raise exception 'You already own this property';
  end if;
  if v_gp.supply is not null and (select count(*) from holdings where game_id = p_g.id and property_id = p_prop) >= v_gp.supply then
    raise exception 'Sold out! Another investor got it first';
  end if;
  v_fee := case when p_g.phase = 'round' then round(v_gp.current_value * p_g.fee_rate) else 0 end;
  v_cost := v_gp.current_value + v_fee;
  select cash into v_cash from players where id = p_pid for update;
  if v_cash < v_cost then raise exception 'Not enough cash (need $% more)', v_cost - v_cash; end if;
  update players set cash = cash - v_cost, expense_total = expense_total + v_fee where id = p_pid;
  insert into holdings (player_id, game_id, property_id, purchase_price, bought_round)
    values (p_pid, p_g.id, p_prop, v_gp.current_value, p_g.round);
  perform _recalc(p_g.id, p_pid);
end $$;

create or replace function _do_sell(p_g games, p_pid uuid, p_prop text) returns void
language plpgsql security definer set search_path = public as $$
declare v_gp game_properties; v_fee bigint;
begin
  perform 1 from players where id = p_pid for update;
  if not exists (select 1 from holdings where player_id = p_pid and property_id = p_prop) then
    raise exception 'You do not own this property';
  end if;
  select * into v_gp from game_properties where game_id = p_g.id and property_id = p_prop;
  v_fee := case when p_g.phase = 'round' then round(v_gp.current_value * p_g.fee_rate) else 0 end;
  delete from holdings where player_id = p_pid and property_id = p_prop;
  update players set cash = cash + v_gp.current_value - v_fee, expense_total = expense_total + v_fee where id = p_pid;
  perform _recalc(p_g.id, p_pid);
end $$;

create or replace function _rank_results(p_game uuid, p_round int) returns void
language sql set search_path = public as $$
  update round_results rr set net_worth = x.net_worth, cash = x.cash, debt = x.debt, rank = x.rk
  from (select id, net_worth, cash, debt, rank() over (order by net_worth desc) rk
        from players where game_id = p_game) x
  where rr.game_id = p_game and rr.round = p_round and rr.player_id = x.id;
$$;

create or replace function _snapshot(p_game uuid, p_round int) returns void
language plpgsql set search_path = public as $$
begin
  insert into round_results (game_id, round, player_id)
    select p_game, p_round, id from players where game_id = p_game
  on conflict do nothing;
  perform _rank_results(p_game, p_round);
end $$;

-- ============================================================ SETTLEMENT
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
    v_int := round(v_pl.debt * v_loan);
    update players set cash = cash + v_inc - v_exp - v_int,
      rent_total = rent_total + v_inc, expense_total = expense_total + v_exp + v_int where id = v_pl.id;
    insert into round_results (game_id, round, player_id, rent_income, expenses)
      values (p_game, v_g.round, v_pl.id, v_inc, v_exp + v_int)
      on conflict (game_id, round, player_id) do update set rent_income = excluded.rent_income, expenses = excluded.expenses;
  end loop;

  -- overdrafts roll into debt
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

-- ============================================================ BOTS
create or replace function _add_bots(p_game uuid, p_count int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_g games; i int; v_name text; v_tries int; v_pid uuid; v_gp record;
  v_names text[] := array['Skyline Sam','Landlord Lou','Mortgage Mike','Condo Carla','Flip Fiona','Escrow Ed','Zoning Zed','Lease Lucy','Equity Eve','Fixer Finn','Broker Bea','Deed Dan','Tenant Tina','Appraisal Al'];
  v_emojis text[] := array['🤖','🦾','👾','🧠','🛰️','🎰','🧮','📈'];
begin
  select * into v_g from games where id = p_game;
  for i in 1..p_count loop
    v_tries := 0;
    loop
      v_name := v_names[1 + floor(random() * array_length(v_names, 1))::int];
      if v_tries > 20 then v_name := v_name || ' ' || (floor(random() * 90) + 10)::text; end if;
      exit when not exists (select 1 from players where game_id = p_game and lower(nickname) = lower(v_name));
      v_tries := v_tries + 1;
    end loop;
    insert into players (game_id, nickname, emoji, cash, net_worth, is_bot)
      values (p_game, v_name, v_emojis[1 + floor(random() * array_length(v_emojis, 1))::int], v_g.starting_cash, v_g.starting_cash, true)
      returning id into v_pid;
    if v_g.phase in ('building', 'round') then
      for v_gp in select property_id from game_properties where game_id = p_game and enabled order by random() loop
        if random() < 0.6 then
          begin perform _do_buy(v_g, v_pid, v_gp.property_id); exception when others then null; end;
        end if;
      end loop;
    end if;
  end loop;
end $$;

create or replace function _bot_moves(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_b record; v_h text; v_gp record;
begin
  select * into v_g from games where id = p_game;
  for v_b in select id from players where game_id = p_game and is_bot loop
    if random() < 0.35 then
      select property_id into v_h from holdings where player_id = v_b.id order by random() limit 1;
      if v_h is not null then begin perform _do_sell(v_g, v_b.id, v_h); exception when others then null; end; end if;
    end if;
    for v_gp in select property_id from game_properties where game_id = p_game and enabled order by random() loop
      if random() < 0.35 then
        begin perform _do_buy(v_g, v_b.id, v_gp.property_id); exception when others then null; end;
      end if;
    end loop;
  end loop;
end $$;

-- ============================================================ SETTINGS
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

-- ============================================================ PUBLIC RPCs
create or replace function create_game(p_name text default null, p_solo boolean default false, p_settings jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_pass text; v_tries int := 0;
begin
  loop
    v_code := _rand_str(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
    exit when not exists (select 1 from games where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 50 then raise exception 'Could not allocate a room code'; end if;
  end loop;
  v_pass := _rand_str(6, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  insert into games (code, name, solo) values (v_code, coalesce(nullif(left(trim(p_name), 60), ''), case when p_solo then 'Practice Run' else 'Real Estate Shark Tank' end), p_solo)
    returning id into v_id;
  insert into game_secrets (game_id, admin_pass) values (v_id, v_pass);
  insert into game_properties (game_id, property_id, name, label, location, type, description, highlight,
      base_price, current_value, base_rent, monthly_rent, risk, maintenance_rate, sort)
    select v_id, id, name, label, location, type, description, highlight, price, price, rent, rent, risk, maintenance_rate, sort
    from property_catalog;
  perform _apply_settings(v_id, coalesce(p_settings, '{}'::jsonb));
  return jsonb_build_object('code', v_code, 'admin_pass', v_pass);
end $$;

create or replace function join_game(p_code text, p_nickname text, p_emoji text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g games; v_nick text; v_emoji text; v_pid uuid; v_token text;
  v_presets text[] := array['🦈','🐺','🦁','🐯','🦅','🐉','🦉','🔥','💎','👑','🚀','🏆','💰','🎩','🕶️','🏙️'];
begin
  select * into v_g from games where code = upper(trim(p_code));
  if not found then raise exception 'Room not found. Check the code.'; end if;
  if v_g.phase = 'finished' then raise exception 'This game has already finished'; end if;
  v_nick := left(trim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g')), 20);
  if char_length(v_nick) < 1 then raise exception 'Pick a nickname'; end if;
  if (select count(*) from players where game_id = v_g.id) >= 150 then raise exception 'This room is full'; end if;
  if exists (select 1 from players where game_id = v_g.id and lower(nickname) = lower(v_nick)) then
    raise exception 'That nickname is already taken';
  end if;
  v_emoji := nullif(trim(coalesce(p_emoji, '')), '');
  if v_emoji is null then v_emoji := v_presets[1 + floor(random() * array_length(v_presets, 1))::int]; end if;
  if char_length(v_emoji) > 16 then raise exception 'Invalid emoji'; end if;
  insert into players (game_id, nickname, emoji, cash, net_worth)
    values (v_g.id, v_nick, v_emoji, v_g.starting_cash, v_g.starting_cash) returning id into v_pid;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into player_secrets (player_id, token) values (v_pid, v_token);
  return jsonb_build_object('player_id', v_pid, 'token', v_token, 'code', v_g.code);
end $$;

create or replace function update_profile(p_code text, p_token text, p_nickname text default null, p_emoji text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_nick text; v_emoji text;
begin
  select * into v_g from games where code = upper(trim(p_code));
  select p.id into v_pid from players p join player_secrets s on s.player_id = p.id where p.game_id = v_g.id and s.token = p_token;
  if v_pid is null then raise exception 'You are not in this game'; end if;
  v_nick := left(trim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g')), 20);
  v_emoji := nullif(trim(coalesce(p_emoji, '')), '');
  if v_emoji is not null and char_length(v_emoji) > 16 then raise exception 'Invalid emoji'; end if;
  if v_nick <> '' and exists (select 1 from players where game_id = v_g.id and lower(nickname) = lower(v_nick) and id <> v_pid) then
    raise exception 'That nickname is already taken';
  end if;
  update players set nickname = coalesce(nullif(v_nick, ''), nickname), emoji = coalesce(v_emoji, emoji) where id = v_pid;
end $$;

create or replace function game_state(p_code text, p_token text default null, p_admin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g games; v_me players; v_admin boolean := false; v_kicked boolean := false; v_ev market_events;
  v_event jsonb; v_props jsonb; v_players jsonb; v_hold jsonb; v_log jsonb; v_res jsonb; v_extra jsonb := '{}';
  v_secs int; v_me_json jsonb;
begin
  select * into v_g from games where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_admin is not null then
    select exists (select 1 from game_secrets s where s.game_id = v_g.id and s.admin_pass = upper(trim(p_admin))) into v_admin;
    if not v_admin then return jsonb_build_object('error', 'bad_admin'); end if;
  end if;
  if p_token is not null then
    select p.* into v_me from players p join player_secrets s on s.player_id = p.id where p.game_id = v_g.id and s.token = p_token;
    if not found then v_kicked := true; end if;
  end if;

  v_secs := case when v_g.paused then v_g.paused_remaining
                 when v_g.ends_at is null then null
                 else greatest(0, ceil(extract(epoch from v_g.ends_at - now()))::int) end;

  if v_g.event_id is not null then
    select * into v_ev from market_events where id = v_g.event_id;
    v_event := jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'emoji', v_ev.emoji, 'headline', v_ev.headline,
      'description', v_ev.description, 'hints', _event_hints(v_ev.effects));
  end if;

  select coalesce(jsonb_agg(to_jsonb(gp) || jsonb_build_object('owned',
      (select count(*) from holdings h where h.game_id = gp.game_id and h.property_id = gp.property_id)) order by gp.sort, gp.property_id), '[]')
    into v_props from game_properties gp where gp.game_id = v_g.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nickname', x.nickname, 'emoji', x.emoji, 'net_worth', x.net_worth,
      'cash', x.cash, 'debt', x.debt, 'rent_total', x.rent_total, 'expense_total', x.expense_total, 'is_bot', x.is_bot,
      'props', (select count(*) from holdings h where h.player_id = x.id), 'rank', x.rk) order by x.rk, x.joined_at), '[]')
    into v_players
    from (select p.*, rank() over (order by p.net_worth desc) rk from players p where p.game_id = v_g.id) x;

  select coalesce(jsonb_agg(to_jsonb(l) - 'game_id' order by l.round), '[]') into v_log from round_log l where l.game_id = v_g.id;
  select coalesce(jsonb_agg(to_jsonb(r) - 'game_id'), '[]') into v_res from round_results r where r.game_id = v_g.id;

  if v_me.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('property_id', h.property_id, 'purchase_price', h.purchase_price, 'bought_round', h.bought_round)), '[]')
      into v_hold from holdings h where h.player_id = v_me.id;
    v_me_json := to_jsonb(v_me) - 'game_id' || jsonb_build_object('holdings', v_hold);
  end if;

  if v_admin then
    v_extra := jsonb_build_object(
      'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'emoji', e.emoji, 'headline', e.headline,
          'description', e.description, 'effects', e.effects, 'loan_rate_delta', e.loan_rate_delta, 'custom', e.game_id is not null)
          order by e.game_id nulls first, e.title), '[]') from market_events e where e.game_id is null or e.game_id = v_g.id),
      'event_plan', (select event_plan from game_secrets where game_id = v_g.id),
      'holdings', (select coalesce(jsonb_agg(jsonb_build_object('player_id', h.player_id, 'property_id', h.property_id, 'purchase_price', h.purchase_price)), '[]')
          from holdings h where h.game_id = v_g.id),
      'event_effects', case when v_ev.id is not null then v_ev.effects end);
  end if;

  return jsonb_build_object(
    'server_now', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'role', case when v_admin then 'admin' when v_me.id is not null then 'player' else 'viewer' end,
    'kicked', v_kicked,
    'game', to_jsonb(v_g) || jsonb_build_object('seconds_left', v_secs),
    'event', v_event, 'properties', v_props, 'players', v_players, 'me', v_me_json,
    'round_log', v_log, 'results', v_res, 'admin', v_extra);
end $$;

create or replace function tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games where code = upper(trim(p_code));
  if found and v_g.phase = 'round' and not v_g.paused and v_g.ends_at is not null and now() > v_g.ends_at + interval '1 second' then
    perform _settle(v_g.id);
  end if;
end $$;

-- ---------- player trading
create or replace function _trade_game(p_code text) returns games
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games where code = upper(trim(p_code)) for share;
  if not found then raise exception 'Game not found'; end if;
  return v_g;
end $$;

create or replace function _trade_pid(p_game uuid, p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  select p.id into v_pid from players p join player_secrets s on s.player_id = p.id where p.game_id = p_game and s.token = p_token;
  if v_pid is null then raise exception 'You are no longer in this game'; end if;
  return v_pid;
end $$;

create or replace function buy_property(p_code text, p_token text, p_property text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid;
begin
  v_g := _trade_game(p_code); v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  perform _do_buy(v_g, v_pid, p_property);
end $$;

create or replace function sell_property(p_code text, p_token text, p_property text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid;
begin
  v_g := _trade_game(p_code); v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  perform _do_sell(v_g, v_pid, p_property);
end $$;

create or replace function borrow(p_code text, p_token text, p_amount bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_debt bigint;
begin
  v_g := _trade_game(p_code); v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  if v_g.phase <> 'round' then raise exception 'Loans open during market rounds'; end if;
  if p_amount <= 0 then raise exception 'Enter an amount'; end if;
  select debt into v_debt from players where id = v_pid for update;
  if v_debt + p_amount > v_g.max_debt then raise exception 'Borrowing limit is $%', v_g.max_debt; end if;
  update players set cash = cash + p_amount, debt = debt + p_amount where id = v_pid;
  perform _recalc(v_g.id, v_pid);
end $$;

create or replace function repay(p_code text, p_token text, p_amount bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_pid uuid; v_p players; v_amt bigint;
begin
  v_g := _trade_game(p_code); v_pid := _trade_pid(v_g.id, p_token);
  perform _trading_ok(v_g);
  select * into v_p from players where id = v_pid for update;
  v_amt := least(p_amount, v_p.debt, v_p.cash);
  if v_amt <= 0 then raise exception 'Nothing to repay'; end if;
  update players set cash = cash - v_amt, debt = debt - v_amt where id = v_pid;
  perform _recalc(v_g.id, v_pid);
end $$;

-- ============================================================ ADMIN RPCs
create or replace function admin_update_settings(p_code text, p_pass text, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  perform _apply_settings(v_g.id, p_settings);
end $$;

create or replace function admin_update_property(p_code text, p_pass text, p_property text, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  update game_properties set
    name = coalesce(nullif(left(trim(p_patch->>'name'), 60), ''), name),
    label = coalesce(nullif(left(trim(p_patch->>'label'), 40), ''), label),
    location = coalesce(nullif(left(trim(p_patch->>'location'), 80), ''), location),
    description = coalesce(left(p_patch->>'description', 240), description),
    highlight = coalesce(left(p_patch->>'highlight', 80), highlight),
    type = coalesce(nullif(trim(p_patch->>'type'), ''), type),
    risk = case when p_patch->>'risk' in ('low','medium','high') then p_patch->>'risk' else risk end,
    current_value = greatest(1000, coalesce((p_patch->>'current_value')::bigint, current_value)),
    base_price = greatest(1000, coalesce((p_patch->>'base_price')::bigint, base_price)),
    monthly_rent = greatest(0, coalesce((p_patch->>'monthly_rent')::int, monthly_rent)),
    base_rent = greatest(0, coalesce((p_patch->>'base_rent')::int, base_rent)),
    maintenance_rate = least(0.2, greatest(0, coalesce((p_patch->>'maintenance_rate')::numeric, maintenance_rate))),
    supply = case when p_patch ? 'supply' then nullif(p_patch->>'supply', '')::int else supply end,
    enabled = coalesce((p_patch->>'enabled')::boolean, enabled)
  where game_id = v_g.id and property_id = p_property;
  if not found then raise exception 'Property not found'; end if;
  perform _recalc(v_g.id);
end $$;

create or replace function admin_add_property(p_code text, p_pass text, p_def jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_g games; v_id text := 'custom-' || _rand_str(6, 'abcdefghjkmnpqrstuvwxyz23456789'); v_price bigint; v_rent int;
begin
  v_g := _admin(p_code, p_pass);
  v_price := greatest(1000, coalesce((p_def->>'price')::bigint, 300000));
  v_rent := greatest(0, coalesce((p_def->>'rent')::int, 2500));
  insert into game_properties (game_id, property_id, name, label, location, type, description, highlight,
      base_price, current_value, base_rent, monthly_rent, risk, maintenance_rate, sort)
    values (v_g.id, v_id, coalesce(nullif(left(trim(p_def->>'name'), 60), ''), 'New Property'),
      coalesce(nullif(left(trim(p_def->>'label'), 40), ''), 'Custom'),
      coalesce(nullif(left(trim(p_def->>'location'), 80), ''), 'Somewhere nice'),
      coalesce(nullif(trim(p_def->>'type'), ''), 'residential'),
      coalesce(left(p_def->>'description', 240), ''), coalesce(left(p_def->>'highlight', 80), ''),
      v_price, v_price, v_rent, v_rent,
      case when p_def->>'risk' in ('low','medium','high') then p_def->>'risk' else 'medium' end,
      least(0.2, greatest(0, coalesce((p_def->>'maintenance_rate')::numeric, 0.015))),
      100 + (select count(*) from game_properties where game_id = v_g.id)::int);
  return v_id;
end $$;

create or replace function admin_create_event(p_code text, p_pass text, p_event jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_g games; v_id text := 'custom-' || _rand_str(6, 'abcdefghjkmnpqrstuvwxyz23456789');
begin
  v_g := _admin(p_code, p_pass);
  insert into market_events (id, game_id, title, emoji, headline, description, effects, loan_rate_delta)
    values (v_id, v_g.id, coalesce(nullif(left(trim(p_event->>'title'), 60), ''), 'Custom Event'),
      coalesce(nullif(left(trim(p_event->>'emoji'), 16), ''), '⚡'),
      coalesce(left(p_event->>'headline', 160), ''), coalesce(left(p_event->>'description', 300), ''),
      coalesce(p_event->'effects', '{}'::jsonb), coalesce((p_event->>'loan_rate_delta')::numeric, 0));
  return v_id;
end $$;

create or replace function admin_delete_event(p_code text, p_pass text, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from market_events where id = p_event and game_id = v_g.id;
end $$;

create or replace function admin_start_building(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_n int;
begin
  v_g := _admin(p_code, p_pass);
  if v_g.phase <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into v_n from players where game_id = v_g.id;
  if v_g.scarcity then
    update game_properties set supply = greatest(2, ceil(v_n * 0.6)::int) where game_id = v_g.id and supply is null;
  end if;
  update games set phase = 'building', paused = false,
    ends_at = case when solo then null else now() + make_interval(secs => build_seconds) end
    where id = v_g.id;
end $$;

create or replace function admin_start_round(p_code text, p_pass text, p_event text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_next int; v_ev text; v_plan jsonb;
begin
  v_g := _admin(p_code, p_pass);
  if v_g.phase not in ('building', 'round_end') then raise exception 'Cannot start a round from here'; end if;
  if v_g.round >= v_g.total_rounds then raise exception 'All rounds are done. Reveal the winner!'; end if;
  v_next := v_g.round + 1;
  select event_plan into v_plan from game_secrets where game_id = v_g.id;
  v_ev := nullif(p_event, 'random');
  if v_ev is null then v_ev := nullif(v_plan->>v_next::text, 'random'); end if;
  if v_ev is null or not exists (select 1 from market_events where id = v_ev and (game_id is null or game_id = v_g.id)) then
    select id into v_ev from market_events
      where game_id is null
        and id not in (select (event->>'id') from round_log where game_id = v_g.id)
        and id not in (select value from jsonb_each_text(coalesce(v_plan, '{}'::jsonb)))
      order by random() limit 1;
    if v_ev is null then select id into v_ev from market_events where game_id is null order by random() limit 1; end if;
  end if;
  if v_g.round = 0 then perform _snapshot(v_g.id, 0); end if;
  update games set phase = 'round', round = v_next, event_id = v_ev, paused = false, paused_remaining = null,
    ends_at = case when solo then null else now() + make_interval(secs => round_seconds) end
    where id = v_g.id;
  perform _bot_moves(v_g.id);
end $$;

create or replace function admin_timer(p_code text, p_pass text, p_action text, p_seconds int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_left int;
begin
  v_g := _admin(p_code, p_pass);
  if v_g.phase not in ('building', 'round') then raise exception 'No timer is running'; end if;
  if p_action = 'add' then
    if v_g.paused then update games set paused_remaining = greatest(0, paused_remaining + p_seconds) where id = v_g.id;
    else update games set ends_at = coalesce(ends_at, now()) + make_interval(secs => p_seconds) where id = v_g.id; end if;
  elsif p_action = 'pause' then
    if not v_g.paused and v_g.ends_at is not null then
      update games set paused = true, paused_remaining = greatest(0, ceil(extract(epoch from ends_at - now()))::int), ends_at = null where id = v_g.id;
    end if;
  elsif p_action = 'resume' then
    if v_g.paused then
      update games set paused = false, ends_at = now() + make_interval(secs => coalesce(paused_remaining, 0)), paused_remaining = null where id = v_g.id;
    end if;
  elsif p_action = 'restart' then
    update games set paused = false, paused_remaining = null,
      ends_at = now() + make_interval(secs => case when v_g.phase = 'building' then build_seconds else round_seconds end) where id = v_g.id;
  elsif p_action = 'end' then
    if v_g.phase = 'round' then perform _settle(v_g.id);
    else update games set ends_at = now(), paused = false, paused_remaining = null where id = v_g.id; end if;
  else raise exception 'Unknown timer action'; end if;
end $$;

create or replace function admin_finish(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  if v_g.phase = 'round' then perform _settle(v_g.id); end if;
  update games set phase = 'finished', ends_at = null, paused = false, paused_remaining = null where id = v_g.id;
end $$;

create or replace function admin_reset_game(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from holdings where game_id = v_g.id;
  delete from round_results where game_id = v_g.id;
  delete from round_log where game_id = v_g.id;
  update game_properties set current_value = base_price, monthly_rent = base_rent where game_id = v_g.id;
  update players set cash = v_g.starting_cash, debt = 0, rent_total = 0, expense_total = 0, net_worth = v_g.starting_cash where game_id = v_g.id;
  update games set phase = 'lobby', round = 0, event_id = null, ends_at = null, paused = false, paused_remaining = null where id = v_g.id;
end $$;

create or replace function admin_delete_game(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from market_events where game_id = v_g.id;
  delete from games where id = v_g.id;
end $$;

create or replace function admin_update_player(p_code text, p_pass text, p_player uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_nick text; v_emoji text;
begin
  v_g := _admin(p_code, p_pass);
  if not exists (select 1 from players where id = p_player and game_id = v_g.id) then raise exception 'Player not found'; end if;
  v_nick := left(trim(regexp_replace(coalesce(p_patch->>'nickname', ''), '\s+', ' ', 'g')), 20);
  v_emoji := nullif(trim(coalesce(p_patch->>'emoji', '')), '');
  if v_emoji is not null and char_length(v_emoji) > 16 then raise exception 'Invalid emoji'; end if;
  if v_nick <> '' and exists (select 1 from players where game_id = v_g.id and lower(nickname) = lower(v_nick) and id <> p_player) then
    raise exception 'That nickname is already taken';
  end if;
  update players set
    nickname = coalesce(nullif(v_nick, ''), nickname),
    emoji = coalesce(v_emoji, emoji),
    cash = case when p_patch ? 'cash' then (p_patch->>'cash')::bigint
                when p_patch ? 'cash_delta' then cash + (p_patch->>'cash_delta')::bigint else cash end,
    debt = greatest(0, coalesce((p_patch->>'debt')::bigint, debt))
  where id = p_player;
  perform _recalc(v_g.id, p_player);
end $$;

create or replace function admin_kick_player(p_code text, p_pass text, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from players where id = p_player and game_id = v_g.id;
  perform _rank_results(v_g.id, v_g.round);
end $$;

create or replace function admin_reset_player(p_code text, p_pass text, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from holdings where player_id = p_player and game_id = v_g.id;
  update players set cash = v_g.starting_cash, debt = 0, rent_total = 0, expense_total = 0 where id = p_player and game_id = v_g.id;
  perform _recalc(v_g.id, p_player);
end $$;

create or replace function admin_player_property(p_code text, p_pass text, p_player uuid, p_property text, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_gp game_properties;
begin
  v_g := _admin(p_code, p_pass);
  select * into v_gp from game_properties where game_id = v_g.id and property_id = p_property;
  if not found then raise exception 'Property not found'; end if;
  if not exists (select 1 from players where id = p_player and game_id = v_g.id) then raise exception 'Player not found'; end if;
  if p_action = 'grant' then
    insert into holdings (player_id, game_id, property_id, purchase_price, bought_round)
      values (p_player, v_g.id, p_property, v_gp.current_value, v_g.round) on conflict do nothing;
  elsif p_action = 'remove' then
    delete from holdings where player_id = p_player and property_id = p_property;
  elsif p_action = 'sell' then
    if exists (select 1 from holdings where player_id = p_player and property_id = p_property) then
      delete from holdings where player_id = p_player and property_id = p_property;
      update players set cash = cash + v_gp.current_value where id = p_player;
    end if;
  else raise exception 'Unknown action'; end if;
  perform _recalc(v_g.id, p_player);
end $$;

create or replace function admin_add_bots(p_code text, p_pass text, p_count int default 3) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  perform _add_bots(v_g.id, least(20, greatest(1, p_count)));
end $$;

create or replace function admin_clear_bots(p_code text, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  v_g := _admin(p_code, p_pass);
  delete from players where game_id = v_g.id and is_bot;
end $$;

-- ============================================================ FUNCTION PRIVILEGES
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  create_game(text, boolean, jsonb), join_game(text, text, text), update_profile(text, text, text, text),
  game_state(text, text, text), tick(text),
  buy_property(text, text, text), sell_property(text, text, text), borrow(text, text, bigint), repay(text, text, bigint),
  admin_update_settings(text, text, jsonb), admin_update_property(text, text, text, jsonb), admin_add_property(text, text, jsonb),
  admin_create_event(text, text, jsonb), admin_delete_event(text, text, text),
  admin_start_building(text, text), admin_start_round(text, text, text), admin_timer(text, text, text, int),
  admin_finish(text, text), admin_reset_game(text, text), admin_delete_game(text, text),
  admin_update_player(text, text, uuid, jsonb), admin_kick_player(text, text, uuid), admin_reset_player(text, text, uuid),
  admin_player_property(text, text, uuid, text, text), admin_add_bots(text, text, int), admin_clear_bots(text, text)
  to anon, authenticated;

-- ============================================================ REALTIME
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table games, players, game_properties, round_results;
  end if;
end $$;

-- ============================================================ SEED: PROPERTIES
insert into property_catalog (id, name, label, location, type, description, highlight, price, rent, risk, maintenance_rate, sort) values
('nittany-rental','Nittany Ave College Rental','College rental','State College, PA','student','Walkable to campus with a waitlist of students every August.','Steady campus demand',450000,3500,'low',0.012,1),
('prairie-fixer','Queen Anne Fixer-Upper','Fixer-upper','Small-town Illinois, c.1898','fixer','A gorgeous but tired Victorian. Buy cheap, hope the market lifts it.','High appreciation potential',250000,1400,'high',0.030,2),
('lakeshore-condo','Lakeshore Luxury Condo','Luxury condo','Chicago, IL','luxury','Corner-view tower unit with a doorman and a rooftop pool.','Premium rental income',800000,5800,'medium',0.015,3),
('crossroads-plaza','Crossroads Retail Plaza','Retail plaza','Suburban Ohio','retail','Six storefronts anchored by a pharmacy and a coffee chain.','Commercial lease income',600000,5200,'high',0.020,4),
('maple-home','Maple Grove Starter Home','Single-family','Columbus, OH','residential','A cozy 3-bed in a good school district. Always rentable.','Reliable family tenants',320000,2400,'low',0.012,5),
('riverside-apts','Riverside 12-Unit Apartments','Apartment building','Pittsburgh, PA','residential','Twelve units, mostly full, steady cash flow.','Diversified tenant base',700000,6200,'medium',0.016,6),
('harbor-warehouse','Harbor Logistics Warehouse','Industrial warehouse','Baltimore, MD','industrial','A distribution warehouse leased to a regional shipping company.','Long-term commercial lease',520000,4300,'medium',0.014,7),
('sunset-villa','Sunset Beach Vacation Villa','Vacation rental','Gulf Coast, FL','vacation','Four bedrooms, private pool, booked solid all summer.','Seasonal income, storm exposure',680000,6000,'high',0.022,8),
('storage-depot','Eastside Self-Storage','Self-storage','Austin, TX','industrial','Climate-controlled units with sticky, recession-resistant tenants.','Low-maintenance cash cow',350000,2900,'low',0.010,9),
('highland-parcel','Highland Land Parcel','Raw land','Edge of a growing metro','land','Forty acres waiting for developers. No rent, only appreciation.','Pure appreciation play',180000,0,'high',0.006,10),
('midtown-office','Midtown Office Suites','Office','Denver, CO','office','Class B offices with a handful of long-term corporate tenants.','Corporate lease income',750000,5900,'high',0.018,11),
('oakwood-duplex','Oakwood Duplex','Duplex','Raleigh, NC','residential','Two matching units, one owner-friendly mortgage payment.','Beginner-friendly landlording',380000,3000,'low',0.012,12);

-- ============================================================ SEED: MARKET EVENTS
-- effects: per type {v:[min,max] value %, r:[min,max] rent %, m:[min,max] maintenance surcharge %}; "all" is added to every type
insert into market_events (id, title, emoji, headline, description, effects, loan_rate_delta) values
('rate-hike','Interest Rates Surge','🏦','The Fed hikes again. Borrowing gets expensive and buyers go quiet.','Mortgage rates jump. Big-ticket and speculative assets feel it most, while renters stay put.',
 '{"all":{"v":[-3,-6]},"luxury":{"v":[-8,-13]},"land":{"v":[-9,-14]},"retail":{"v":[-5,-8]},"office":{"v":[-4,-8]},"residential":{"r":[2,5]}}',0.03),
('rate-cut','Rate Cut Relief','🪙','Rates fall and buyers rush back into the market.','Cheaper money lifts prices, especially for luxury and speculative plays.',
 '{"all":{"v":[2,5]},"luxury":{"v":[4,8]},"fixer":{"v":[4,8]},"land":{"v":[3,7]},"residential":{"v":[2,4]}}',-0.02),
('tech-campus','Tech Giant Announces Campus','💻','A major employer is moving to town with thousands of jobs.','Housing demand surges near the new campus and land speculators pounce.',
 '{"residential":{"v":[8,14],"r":[5,9]},"student":{"v":[4,8],"r":[3,6]},"land":{"v":[15,28]},"retail":{"v":[5,9]},"office":{"v":[4,9]},"luxury":{"v":[4,8]},"fixer":{"v":[8,15]}}',0),
('enrollment','Record University Enrollment','🎓','Campuses overflow and students are fighting for housing.','Student rentals are suddenly the hottest asset in town.',
 '{"student":{"v":[10,16],"r":[8,14]},"residential":{"v":[2,4],"r":[2,4]},"retail":{"v":[2,5]},"fixer":{"v":[2,5]}}',0),
('ecommerce','E-Commerce Boom','📦','Everyone shops online. Malls empty out and warehouses fill up.','Retail space loses tenants while logistics space is in demand.',
 '{"retail":{"v":[-12,-20],"r":[-8,-15]},"office":{"v":[-3,-6]},"industrial":{"v":[8,14],"r":[6,10]}}',0),
('remote-work','Remote Work Revolution','🏠','Companies go fully remote and downtown offices go dark.','Offices crater while suburban homes and getaways gain.',
 '{"office":{"v":[-14,-22],"r":[-10,-18]},"residential":{"v":[3,6]},"vacation":{"v":[4,8],"r":[3,6]}}',0),
('housing-boom','Housing Market Boom','🚀','Bidding wars everywhere. Prices are climbing fast.','A hot market lifts almost everything, with fixer-uppers and land flying highest.',
 '{"residential":{"v":[7,12],"r":[2,4]},"luxury":{"v":[6,11]},"fixer":{"v":[10,20]},"student":{"v":[4,8]},"vacation":{"v":[6,10]},"land":{"v":[8,14]},"industrial":{"v":[0,2]},"retail":{"v":[0,2]},"office":{"v":[0,2]}}',0),
('housing-correction','Housing Correction','📉','The bubble pops. Prices slide and speculators get burned.','Overheated assets drop the hardest. Everyday rentals hold on.',
 '{"residential":{"v":[-5,-9]},"luxury":{"v":[-10,-16]},"fixer":{"v":[-12,-22]},"vacation":{"v":[-9,-15]},"land":{"v":[-10,-18]},"student":{"v":[-2,-5]},"retail":{"v":[-1,-3]},"office":{"v":[-1,-3]}}',0),
('hurricane','Hurricane Season','🌀','A monster storm is forecast for the coast.','Repair bills spike across the board and beachfront property takes the worst of it.',
 '{"vacation":{"v":[-12,-22],"m":[80,150]},"residential":{"v":[-1,-4],"m":[20,40]},"fixer":{"v":[-3,-6],"m":[60,110]},"luxury":{"m":[10,30]},"student":{"m":[15,30]},"retail":{"m":[20,40]},"industrial":{"m":[15,30]},"office":{"m":[10,20]}}',0),
('tourism','Tourism Surge','🏖️','Travel is booming and every rental is booked.','Vacation rentals print money, and local shops benefit too.',
 '{"vacation":{"v":[12,20],"r":[15,25]},"retail":{"v":[4,8],"r":[3,6]},"luxury":{"v":[3,6]},"residential":{"v":[1,3]}}',0),
('tax-reassess','Property Tax Reassessment','🧾','The county reassesses every parcel. Tax bills are coming.','Operating costs jump for everyone, especially luxury properties and land.',
 '{"all":{"v":[-1,-3],"m":[30,60]},"luxury":{"v":[-2,-4],"m":[35,55]},"land":{"m":[40,70]},"vacation":{"m":[10,25]}}',0),
('rezoning','Mixed-Use Rezoning','🏗️','The city rezones a huge district for development.','Land and fixer-uppers near the zone are suddenly valuable.',
 '{"land":{"v":[18,32]},"fixer":{"v":[10,18]},"retail":{"v":[5,9]},"office":{"v":[3,7]},"residential":{"v":[2,4]}}',0),
('recession','Recession Hits','😬','Layoffs spread and everyone tightens their belts.','Discretionary and commercial assets suffer. Basic housing holds up best.',
 '{"all":{"v":[-3,-5]},"retail":{"v":[-8,-12],"r":[-8,-14]},"office":{"v":[-6,-10],"r":[-5,-10]},"luxury":{"v":[-6,-10]},"vacation":{"v":[-7,-12],"r":[-6,-12]},"student":{"r":[-2,-4]},"fixer":{"v":[-5,-9]},"land":{"v":[-4,-8]}}',0),
('highway','New Highway Interchange','🛣️','A new interchange will connect the region to the interstate.','Logistics and land near the exit pop, and nearby retail gets traffic.',
 '{"industrial":{"v":[10,16],"r":[6,10]},"land":{"v":[10,18]},"retail":{"v":[4,8],"r":[3,6]},"residential":{"v":[1,3]}}',0),
('rent-control','Rent Control Passed','⚖️','City council caps rent increases and cuts rents on older units.','Residential and student landlords take a hit in both income and value.',
 '{"residential":{"v":[-4,-7],"r":[-9,-14]},"student":{"v":[-3,-6],"r":[-8,-12]},"fixer":{"v":[-2,-4]}}',0),
('luxury-boom','Wealthy Buyers Flood In','💎','Out-of-town money is pouring into high-end real estate.','Luxury assets surge while everything else gets a mild lift.',
 '{"luxury":{"v":[12,20],"r":[8,12]},"vacation":{"v":[6,10]},"residential":{"v":[2,4]},"land":{"v":[3,6]}}',0),
('supply-chain','Supply Chain Squeeze','🚢','Materials cost more and goods pile up at the ports.','Repair costs rise everywhere, but storage and warehouse space is gold.',
 '{"all":{"m":[10,25]},"industrial":{"v":[6,11],"r":[4,8]},"retail":{"v":[-2,-5]}}',0);
