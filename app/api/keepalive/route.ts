import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Called once a day by Vercel (see vercel.json). A tiny read keeps the free Supabase project from pausing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const { error } = await serverClient().from("public_offers").select("id").limit(1);
  return NextResponse.json({ ok: !error });
}
