-- Florenti: admin tools for running monthly offers.
-- Run in the Supabase SQL editor after 001 and 002.

-- Only one offer can be live at a time.
create unique index offers_one_active on public.offers ((true)) where active;

-- Create or edit an offer and choose its scents, optionally making it the live one.
create function public.save_offer(
  p_offer_id uuid, p_name text, p_bars integer, p_price_pence integer, p_ml_per_bar integer,
  p_scent_ids uuid[], p_activate boolean
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
    insert into public.offers (name, bars_per_box, price_pence, ml_per_bar, active)
      values (p_name, p_bars, p_price_pence, p_ml_per_bar, false) returning id into v_id;
  else
    update public.offers set name = p_name, bars_per_box = p_bars, price_pence = p_price_pence, ml_per_bar = p_ml_per_bar
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

-- Switch an offer on (switching any other off) or off.
create function public.set_offer_active(p_offer_id uuid, p_active boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  if not exists (select 1 from public.offers where id = p_offer_id) then raise exception 'offer_not_found'; end if;
  if p_active then update public.offers set active = false where active and id <> p_offer_id; end if;
  update public.offers set active = p_active where id = p_offer_id;
  return true;
end $$;

revoke all on function public.save_offer(uuid, text, integer, integer, integer, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.set_offer_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.save_offer(uuid, text, integer, integer, integer, uuid[], boolean) to authenticated;
grant execute on function public.set_offer_active(uuid, boolean) to authenticated;
