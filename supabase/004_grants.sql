-- Florenti: give signed-in admins access to the tables (row-level security still decides who sees what).
-- Needed on newer Supabase projects, which no longer grant this automatically. Safe to run more than once.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.scents, public.offers, public.offer_scents to authenticated;
grant select on public.orders, public.order_items, public.inventory_movements, public.admin_users to authenticated;
grant usage, select on all sequences in schema public to authenticated;
