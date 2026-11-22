-- Florenti: database schema, stock rules and access policies
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).

-- ---------- Tables ----------
create table public.scents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  inspired_by text not null default '',
  description text not null default '',
  tags        text[] not null default '{}',
  stock_ml    integer not null default 0 check (stock_ml >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index scents_name_key on public.scents (lower(name));

-- An "offer" is a box people can order: how many bars, the price, and how much oil each bar uses.
-- Future products (gift sets, other box sizes) are just more rows here.
create table public.offers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  bars_per_box integer not null check (bars_per_box > 0),
  price_pence  integer not null check (price_pence >= 0),
  ml_per_bar   integer not null check (ml_per_bar > 0),
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Which scents are in this month's selection for an offer.
create table public.offer_scents (
  offer_id uuid not null references public.offers(id) on delete cascade,
  scent_id uuid not null references public.scents(id) on delete cascade,
  primary key (offer_id, scent_id)
);

create sequence public.order_ref_seq start 1001;

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('FLO-' || nextval('public.order_ref_seq')::text),
  offer_id      uuid not null references public.offers(id),
  customer_name text not null,
  email         text not null default '',
  phone         text not null default '',
  notes         text not null default '',
  status        text not null default 'new' check (status in ('new','paid','making','completed','cancelled')),
  total_pence   integer not null,
  restocked_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  scent_id   uuid not null references public.scents(id),
  quantity   integer not null check (quantity > 0),
  ml_per_bar integer not null check (ml_per_bar > 0),   -- snapshot, so later rate changes never alter old orders
  unique (order_id, scent_id)
);

-- Every change to stock, ever. stock_ml on scents always equals the sum of its movements.
create table public.inventory_movements (
  id         bigint generated always as identity primary key,
  scent_id   uuid not null references public.scents(id),
  delta_ml   integer not null check (delta_ml <> 0),
  reason     text not null check (reason in ('initial','order','order_cancelled','manual_add','manual_remove','fair','offline_order','correction')),
  order_id   uuid references public.orders(id),
  note       text not null default '',
  actor      uuid,
  created_at timestamptz not null default now()
);
-- Safety net: an order can only ever deduct once and restore once per scent.
create unique index movements_once_per_order on public.inventory_movements (order_id, scent_id, reason)
  where order_id is not null and reason in ('order','order_cancelled');

create table public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Admin check ----------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------- Stock can only change through the functions below ----------
create function public.scents_guard() returns trigger language plpgsql as $$
declare changed boolean;
begin
  if tg_op = 'INSERT' then changed := new.stock_ml <> 0;
  else changed := new.stock_ml is distinct from old.stock_ml; end if;
  if changed and coalesce(current_setting('app.stock_change', true), '') <> 'on' then
    raise exception 'stock_must_use_function';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger scents_guard before insert or update on public.scents
  for each row execute function public.scents_guard();

-- ---------- Public views (no stock numbers exposed) ----------
-- A scent is available while at least one bar (5 ml) can still be made.
create view public.public_scents as
  select id, name, inspired_by, description, tags
  from public.scents
  where active and stock_ml >= 5;

create view public.public_offers as
  select id, name, bars_per_box, price_pence from public.offers where active;

-- max_bars is capped at the box size, so it never reveals real stock levels.
create view public.public_offer_scents as
  select o.id as offer_id, s.id as scent_id, s.name, s.inspired_by, s.description, s.tags,
         least(o.bars_per_box, s.stock_ml / o.ml_per_bar) as max_bars
  from public.offers o
  join public.offer_scents os on os.offer_id = o.id
  join public.scents s on s.id = os.scent_id
  where o.active and s.active and s.stock_ml >= o.ml_per_bar;

-- ---------- Place an order: validate, lock, check stock, deduct, record. All or nothing. ----------
create function public.place_order(
  p_offer_id uuid, p_name text, p_email text, p_phone text, p_notes text, p_items jsonb
) returns table (order_id uuid, ref text, total_pence integer)
language plpgsql security definer set search_path = public as $$
declare
  v_offer  public.offers%rowtype;
  v_order  public.orders%rowtype;
  v_bars   integer;
  v_found  integer;
  v_expect integer;
  r        record;
begin
  p_name  := btrim(coalesce(p_name, ''));
  p_email := btrim(coalesce(p_email, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_notes := btrim(coalesce(p_notes, ''));
  if length(p_name) < 2 or length(p_name) > 100 then raise exception 'invalid_name'; end if;
  if p_email <> '' and (length(p_email) > 200 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if length(p_phone) > 40 then raise exception 'invalid_phone'; end if;
  if p_email = '' and length(p_phone) < 7 then raise exception 'contact_required'; end if;
  if length(p_notes) > 1000 then raise exception 'notes_too_long'; end if;

  select * into v_offer from public.offers where id = p_offer_id and active;
  if not found then raise exception 'offer_unavailable'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 60 then
    raise exception 'invalid_items';
  end if;

  -- merge duplicate lines, validate shape
  drop table if exists _po_items;
  begin
    create temporary table _po_items on commit drop as
      select (e->>'scent_id')::uuid as scent_id, sum((e->>'quantity')::integer)::integer as qty
      from jsonb_array_elements(p_items) e group by 1;
  exception when others then
    raise exception 'invalid_items';
  end;
  if exists (select 1 from _po_items where qty < 1) then raise exception 'invalid_items'; end if;

  select coalesce(sum(qty), 0), count(*) into v_bars, v_expect from _po_items;
  if v_bars <> v_offer.bars_per_box then raise exception 'wrong_bar_count'; end if;

  -- lock the scent rows in a fixed order (prevents overselling and deadlocks)
  select count(*) into v_found from (
    select 1 from public.scents where id in (select scent_id from _po_items) order by id for update
  ) l;
  if v_found <> v_expect then raise exception 'unknown_scent'; end if;

  for r in
    select s.name, s.stock_ml, s.active, a.qty, (os.scent_id is not null) as offered
    from _po_items a
    join public.scents s on s.id = a.scent_id
    left join public.offer_scents os on os.offer_id = v_offer.id and os.scent_id = s.id
  loop
    if not r.offered or not r.active then raise exception 'scent_unavailable' using detail = r.name; end if;
    if r.stock_ml < r.qty * v_offer.ml_per_bar then raise exception 'insufficient_stock' using detail = r.name; end if;
  end loop;

  insert into public.orders (offer_id, customer_name, email, phone, notes, total_pence)
    values (v_offer.id, p_name, p_email, p_phone, p_notes, v_offer.price_pence)
    returning * into v_order;
  insert into public.order_items (order_id, scent_id, quantity, ml_per_bar)
    select v_order.id, scent_id, qty, v_offer.ml_per_bar from _po_items;

  perform set_config('app.stock_change', 'on', true);
  update public.scents s set stock_ml = s.stock_ml - a.qty * v_offer.ml_per_bar
    from _po_items a where s.id = a.scent_id;
  insert into public.inventory_movements (scent_id, delta_ml, reason, order_id)
    select scent_id, -(qty * v_offer.ml_per_bar), 'order', v_order.id from _po_items;

  return query select v_order.id, v_order.ref, v_order.total_pence;
end $$;

-- ---------- Cancel an order and give the oil back, exactly once ----------
create function public.cancel_order(p_order_id uuid, p_note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; r record;
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status = 'cancelled' then return false; end if;   -- already cancelled: do nothing

  perform 1 from public.scents where id in (select scent_id from public.order_items where order_id = o.id) order by id for update;
  perform set_config('app.stock_change', 'on', true);
  for r in select scent_id, quantity * ml_per_bar as ml from public.order_items where order_id = o.id loop
    update public.scents set stock_ml = stock_ml + r.ml where id = r.scent_id;
    insert into public.inventory_movements (scent_id, delta_ml, reason, order_id, note, actor)
      values (r.scent_id, r.ml, 'order_cancelled', o.id, coalesce(p_note, ''), auth.uid());
  end loop;
  update public.orders set status = 'cancelled', restocked_at = now(), updated_at = now() where id = o.id;
  return true;
end $$;

-- ---------- Change an order's status (cancelling goes through cancel_order) ----------
create function public.set_order_status(p_order_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  if p_status not in ('new','paid','making','completed','cancelled') then raise exception 'invalid_status'; end if;
  if p_status = 'cancelled' then return public.cancel_order(p_order_id); end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status = 'cancelled' then raise exception 'order_cancelled'; end if;
  update public.orders set status = p_status, updated_at = now() where id = o.id;
  return true;
end $$;

-- ---------- Manual stock changes (fairs, offline orders, new oil, corrections) ----------
create function public.adjust_stock(p_scent_id uuid, p_delta_ml integer, p_reason text, p_note text default '')
returns integer
language plpgsql security definer set search_path = public as $$
declare s public.scents%rowtype;
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  if p_delta_ml is null or p_delta_ml = 0 then raise exception 'invalid_amount'; end if;
  if p_reason not in ('manual_add','manual_remove','fair','offline_order','correction') then raise exception 'invalid_reason'; end if;
  select * into s from public.scents where id = p_scent_id for update;
  if not found then raise exception 'unknown_scent'; end if;
  if s.stock_ml + p_delta_ml < 0 then raise exception 'insufficient_stock' using detail = s.name; end if;
  perform set_config('app.stock_change', 'on', true);
  update public.scents set stock_ml = stock_ml + p_delta_ml where id = s.id;
  insert into public.inventory_movements (scent_id, delta_ml, reason, note, actor)
    values (s.id, p_delta_ml, p_reason, coalesce(p_note, ''), auth.uid());
  return s.stock_ml + p_delta_ml;
end $$;

-- ---------- Access rules ----------
alter table public.scents              enable row level security;
alter table public.offers              enable row level security;
alter table public.offer_scents        enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.admin_users         enable row level security;

create policy admin_all on public.scents       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.offers       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.offer_scents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_read on public.orders      for select to authenticated using (public.is_admin());
create policy admin_read on public.order_items for select to authenticated using (public.is_admin());
create policy admin_read on public.inventory_movements for select to authenticated using (public.is_admin());
create policy admin_read on public.admin_users for select to authenticated using (public.is_admin());

-- Visitors (anon) get no direct table access at all: only the three views and place_order.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon, authenticated;
grant select on public.public_scents, public.public_offers, public.public_offer_scents to anon, authenticated;
grant execute on function public.place_order(uuid, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text, text) to authenticated;
