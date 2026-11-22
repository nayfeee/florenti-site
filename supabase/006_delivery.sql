-- Florenti: delivery address and delivery-from date.
-- Run in the Supabase SQL editor AFTER 001, 002, 003 and 004. Safe to run once.
-- This replaces place_order and save_offer with versions that take the new fields, so deploy the new website right after.

alter table public.orders
  add column address_line1 text not null default '',
  add column address_line2 text not null default '',
  add column town          text not null default '',
  add column postcode      text not null default '',
  add column delivery_from date;

alter table public.offers add column delivery_from date;

-- Turns "sk41ab" / "SK4  1AB" into "SK4 1AB", or null if it is not a valid UK postcode shape.
create function public.normalise_postcode(p text) returns text
language sql immutable as $$
  select case
    when upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'
    then regexp_replace(upper(regexp_replace(p, '\s', '', 'g')), '^(.+)(.{3})$', '\1 \2')
  end
$$;

-- Public view now also shows when delivery starts.
create or replace view public.public_offers as
  select id, name, bars_per_box, price_pence, delivery_from from public.offers where active;
grant select on public.public_offers to anon, authenticated;

-- Remove the old versions so nobody can order without an address.
drop function public.place_order(uuid, text, text, text, text, jsonb);
drop function public.save_offer(uuid, text, integer, integer, integer, uuid[], boolean);

-- ---------- Place an order (now with delivery address) ----------
create function public.place_order(
  p_offer_id uuid, p_name text, p_email text, p_phone text, p_notes text, p_items jsonb,
  p_address_line1 text, p_address_line2 text, p_town text, p_postcode text
) returns table (order_id uuid, ref text, total_pence integer, delivery_from date)
language plpgsql security definer set search_path = public as $$
declare
  v_offer  public.offers%rowtype;
  v_order  public.orders%rowtype;
  v_bars   integer;
  v_found  integer;
  v_expect integer;
  r        record;
  v_pc     text;
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

  p_address_line1 := btrim(coalesce(p_address_line1, ''));
  p_address_line2 := btrim(coalesce(p_address_line2, ''));
  p_town          := btrim(coalesce(p_town, ''));
  if length(p_address_line1) < 3 or length(p_address_line1) > 150 or length(p_address_line2) > 150 then raise exception 'invalid_address'; end if;
  if length(p_town) < 2 or length(p_town) > 80 then raise exception 'invalid_town'; end if;
  v_pc := public.normalise_postcode(p_postcode);
  if v_pc is null then raise exception 'invalid_postcode'; end if;

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

  insert into public.orders (offer_id, customer_name, email, phone, notes, total_pence, address_line1, address_line2, town, postcode, delivery_from)
    values (v_offer.id, p_name, p_email, p_phone, p_notes, v_offer.price_pence, p_address_line1, p_address_line2, p_town, v_pc, v_offer.delivery_from)
    returning * into v_order;
  insert into public.order_items (order_id, scent_id, quantity, ml_per_bar)
    select v_order.id, scent_id, qty, v_offer.ml_per_bar from _po_items;

  perform set_config('app.stock_change', 'on', true);
  update public.scents s set stock_ml = s.stock_ml - a.qty * v_offer.ml_per_bar
    from _po_items a where s.id = a.scent_id;
  insert into public.inventory_movements (scent_id, delta_ml, reason, order_id)
    select scent_id, -(qty * v_offer.ml_per_bar), 'order', v_order.id from _po_items;

  return query select v_order.id, v_order.ref, v_order.total_pence, v_order.delivery_from;
end $$;

-- ---------- Create or edit an offer (now with a delivery-from date) ----------
create function public.save_offer(
  p_offer_id uuid, p_name text, p_bars integer, p_price_pence integer, p_ml_per_bar integer,
  p_scent_ids uuid[], p_activate boolean, p_delivery_from date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' or length(p_name) > 100 then raise exception 'invalid_name'; end if;
  if p_bars is null or p_bars not between 1 and 100 then raise exception 'invalid_bars'; end if;
  if p_price_pence is null or p_price_pence < 0 then raise exception 'invalid_price'; end if;
  if p_ml_per_bar is null or p_ml_per_bar not between 1 and 1000 then raise exception 'invalid_ml'; end if;

  if p_offer_id is null then
    insert into public.offers (name, bars_per_box, price_pence, ml_per_bar, active, delivery_from)
      values (p_name, p_bars, p_price_pence, p_ml_per_bar, false, p_delivery_from) returning id into v_id;
  else
    update public.offers set name = p_name, bars_per_box = p_bars, price_pence = p_price_pence, ml_per_bar = p_ml_per_bar, delivery_from = p_delivery_from
      where id = p_offer_id returning id into v_id;
    if v_id is null then raise exception 'offer_not_found'; end if;
  end if;

  delete from public.offer_scents where offer_id = v_id and not (scent_id = any (coalesce(p_scent_ids, '{}')));
  insert into public.offer_scents (offer_id, scent_id)
    select v_id, s from unnest(coalesce(p_scent_ids, '{}')) s on conflict do nothing;

  if p_activate then
    update public.offers set active = false where active and id <> v_id;
    update public.offers set active = true where id = v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.normalise_postcode(text) from public, anon, authenticated;
revoke all on function public.place_order(uuid, text, text, text, text, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, text, text, jsonb, text, text, text, text) to anon, authenticated;
revoke all on function public.save_offer(uuid, text, integer, integer, integer, uuid[], boolean, date) from public, anon, authenticated;
grant execute on function public.save_offer(uuid, text, integer, integer, integer, uuid[], boolean, date) to authenticated;
