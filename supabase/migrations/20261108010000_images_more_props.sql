-- Property photos (optional URL, falls back to generated art) + a bigger catalog.
alter table game_properties add column if not exists image_url text;
alter table property_catalog add column if not exists image_url text;

insert into property_catalog (id, name, label, location, type, description, highlight, price, rent, risk, maintenance_rate, sort) values
('campus-triplex','Campus Edge Triplex','Student triplex','Ann Arbor, MI','student','Three units a short bike ride from lecture halls. Leases roll every August.','Built-in student demand',390000,3400,'medium',0.014,13),
('downtown-loft','Warehouse District Loft','Luxury loft','Minneapolis, MN','luxury','Exposed brick, 14-foot ceilings and a waitlist of young professionals.','Trendy urban rental',560000,4300,'medium',0.014,14),
('mainstreet-row','Main Street Retail Row','Retail row','Charleston, SC','retail','Five historic storefronts on the busiest walking street in town.','Tourist foot traffic',420000,3600,'medium',0.018,15),
('mountain-cabin','Pine Ridge Mountain Cabin','Vacation cabin','Smoky Mountains, TN','vacation','A log cabin with a hot tub that books out every fall weekend.','Seasonal cash flow',340000,2900,'high',0.024,16),
('flex-park','Gateway Flex Industrial Park','Flex industrial','Indianapolis, IN','industrial','Eight flexible bays rented to contractors and light manufacturers.','Diversified tenants',640000,5200,'medium',0.014,17),
('farm-acreage','Willow Creek Farm Acreage','Farmland','Central Iowa','land','Eighty acres of leased cropland. Small rent, big long-term upside.','Land with a small lease',260000,800,'medium',0.005,18),
('skyline-penthouse','Skyline Penthouse','Luxury penthouse','Miami, FL','luxury','Full-floor penthouse with wraparound terrace and ocean views.','Trophy asset',900000,6800,'high',0.016,19),
('ranch-fixer','Foreclosed Ranch Fixer','Fixer-upper','Tulsa, OK','fixer','Bank-owned ranch house with good bones and a lot of deferred maintenance.','Flip or hold',190000,900,'high',0.032,20),
('medical-office','Parkside Medical Offices','Medical office','Nashville, TN','office','Dentists and physical therapists on long leases right by the hospital.','Sticky professional tenants',480000,3900,'medium',0.016,21);

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
  insert into games (code, name, solo) values (v_code, coalesce(nullif(left(trim(p_name), 60), ''), 'Real Estate Shark Tank'), p_solo)
    returning id into v_id;
  insert into game_secrets (game_id, admin_pass) values (v_id, v_pass);
  insert into game_properties (game_id, property_id, name, label, location, type, description, highlight,
      base_price, current_value, base_rent, monthly_rent, risk, maintenance_rate, sort, image_url)
    select v_id, id, name, label, location, type, description, highlight, price, price, rent, rent, risk, maintenance_rate, sort, image_url
    from property_catalog;
  perform _apply_settings(v_id, coalesce(p_settings, '{}'::jsonb));
  return jsonb_build_object('code', v_code, 'admin_pass', v_pass);
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
    image_url = case when p_patch ? 'image_url' then nullif(left(trim(p_patch->>'image_url'), 500), '') else image_url end,
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
      base_price, current_value, base_rent, monthly_rent, risk, maintenance_rate, sort, image_url)
    values (v_g.id, v_id, coalesce(nullif(left(trim(p_def->>'name'), 60), ''), 'New Property'),
      coalesce(nullif(left(trim(p_def->>'label'), 40), ''), 'Custom'),
      coalesce(nullif(left(trim(p_def->>'location'), 80), ''), 'Somewhere nice'),
      coalesce(nullif(trim(p_def->>'type'), ''), 'residential'),
      coalesce(left(p_def->>'description', 240), ''), coalesce(left(p_def->>'highlight', 80), ''),
      v_price, v_price, v_rent, v_rent,
      case when p_def->>'risk' in ('low','medium','high') then p_def->>'risk' else 'medium' end,
      least(0.2, greatest(0, coalesce((p_def->>'maintenance_rate')::numeric, 0.015))),
      100 + (select count(*) from game_properties where game_id = v_g.id)::int,
      nullif(left(trim(p_def->>'image_url'), 500), ''));
  return v_id;
end $$;

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
