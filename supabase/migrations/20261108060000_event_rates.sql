-- More events move interest rates, and the announcement shows the rate direction.
update market_events set loan_rate_delta = 0.03 where id = 'rate-hike';
update market_events set loan_rate_delta = -0.02 where id = 'rate-cut';
update market_events set loan_rate_delta = -0.01 where id = 'recession';
update market_events set loan_rate_delta = 0.01 where id = 'housing-boom';
update market_events set loan_rate_delta = 0.005 where id = 'tech-campus';
update market_events set loan_rate_delta = 0.02 where id = 'housing-correction';
update market_events set loan_rate_delta = 0.01 where id = 'hurricane';
update market_events set loan_rate_delta = 0.015 where id = 'supply-chain';
update market_events set loan_rate_delta = 0.005 where id = 'luxury-boom';
update market_events set loan_rate_delta = 0.005 where id = 'tourism';
update market_events set loan_rate_delta = 0.01 where id = 'rent-control';
update market_events set loan_rate_delta = 0.005 where id = 'ecommerce';
update market_events set loan_rate_delta = -0.005 where id = 'remote-work';

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
      'description', v_ev.description, 'hints', _event_hints(v_ev.effects), 'rate', v_ev.loan_rate_delta);
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

grant execute on function game_state(text, text, text) to anon, authenticated;
