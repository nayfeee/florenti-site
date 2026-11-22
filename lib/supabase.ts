import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

/** For server code (pages, API routes): no login session, read-only public views + place_order. */
export function serverClient(): SupabaseClient {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

let browser: SupabaseClient | null = null;
/** For the admin page: keeps the admin's login session in the browser. */
export function browserClient(): SupabaseClient {
  if (!browser) browser = createClient(URL, KEY);
  return browser;
}

/** Same as browserClient(), but only created when first used, so building the site never needs the keys. */
export const sb: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c: any = browserClient();
    const v = c[prop];
    return typeof v === "function" ? v.bind(c) : v;
  },
});
