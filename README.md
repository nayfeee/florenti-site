# Florenti website

Next.js site with a Supabase database.

- `/` scent menu (reads live stock, hides anything under 5 ml)
- `/monthly-offer` this month's snap bar box (stock is deducted when an order is placed)
- `/admin` private admin (orders, stock, monthly offers, history)

`supabase/` holds the SQL (run 001, 002, 003 once, in order, in the Supabase SQL editor).
Settings live in Vercel > Settings > Environment Variables. See `.env.example` for the names. Never commit real keys.
