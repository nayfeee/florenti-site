import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// TEMPORARY: shows what the live site sees (no secrets). Delete this file once the scents show.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const info = {
    urlSet: !!url,
    urlValue: url,
    urlHasSpaceOrSlashAtEnd: /[\s/]$/.test(url) || /^\s/.test(url),
    urlHasQuotes: /["']/.test(url),
    keySet: !!key,
    keyLength: key.length,
    keyStartsWith: key.slice(0, 5),
    keyHasSpaceOrQuote: /[\s"']/.test(key),
    keyKind: key.startsWith("sb_publishable_") ? "publishable" : key.startsWith("eyJ") ? "legacy-anon-style" : "unknown",
  };
  let query: any;
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const r = await db.from("public_scents").select("name").limit(1);
    query = r.error ? { ok: false, message: r.error.message, code: r.error.code, details: r.error.details, hint: r.error.hint } : { ok: true, rows: r.data?.length };
  } catch (e: any) {
    query = { ok: false, thrown: String(e?.message || e) };
  }
  return NextResponse.json({ info, query });
}