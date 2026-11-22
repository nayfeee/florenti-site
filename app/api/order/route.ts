import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const gbp = (pence: number) => "£" + (pence / 100).toFixed(2);

function customerMessage(code: string, detail?: string): string {
  switch (code) {
    case "insufficient_stock": return `Sorry, ${detail || "one of your scents"} doesn’t have enough left for your box. We’ve refreshed the list, so please adjust your selection.`;
    case "scent_unavailable": return `Sorry, ${detail || "one of your scents"} is no longer available this month. We’ve refreshed the list, so please adjust your selection.`;
    case "offer_unavailable": return "Sorry, this offer has just finished.";
    case "wrong_bar_count": return "Please choose exactly the right number of bars.";
    case "invalid_name": return "Please enter your name.";
    case "invalid_email": return "That email address doesn’t look right.";
    case "contact_required": return "Please give us an email address or a phone number.";
    case "invalid_phone": return "That phone number doesn’t look right.";
    case "notes_too_long": return "Your notes are a little too long. Please shorten them.";
    default: return "Something went wrong placing your order. Please try again, or message us on WhatsApp.";
  }
}

async function sendEmail(subject: string, html: string, text: string, replyTo?: string) {
  const key = process.env.RESEND_API_KEY, to = process.env.ORDER_NOTIFY_EMAIL;
  if (!key || !to) { console.warn("Order email skipped: RESEND_API_KEY or ORDER_NOTIFY_EMAIL not set"); return; }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Florenti <onboarding@resend.dev>", to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!r.ok) console.error("Resend error", r.status, await r.text());
  } catch (e) { console.error("Order email failed", e); }
  finally { clearTimeout(t); }
}

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, code: "bad_request", message: customerMessage("") }, { status: 400 }); }
  if (b?.website) return NextResponse.json({ ok: true, ref: "FLO-0000" }); // honeypot filled in: a bot. Pretend it worked, save nothing.

  const items = Array.isArray(b?.items) ? b.items : null;
  if (!b || typeof b.offerId !== "string" || !items || items.length < 1 || items.length > 60 || items.some((i: any) => typeof i?.scent_id !== "string" || !Number.isInteger(i?.quantity))) {
    return NextResponse.json({ ok: false, code: "bad_request", message: customerMessage("") }, { status: 400 });
  }

  const db = serverClient();
  const names = Object.fromEntries(((await db.from("public_offer_scents").select("scent_id,name").eq("offer_id", b.offerId)).data || []).map((r: any) => [r.scent_id, r.name]));

  const { data, error } = await db.rpc("place_order", {
    p_offer_id: b.offerId, p_name: String(b.name ?? ""), p_email: String(b.email ?? ""), p_phone: String(b.phone ?? ""), p_notes: String(b.notes ?? ""), p_items: items,
  });
  if (error || !data?.[0]) {
    const code = (error?.message || "").trim();
    return NextResponse.json({ ok: false, code, message: customerMessage(code, error?.details || undefined) }, { status: code === "insufficient_stock" || code === "scent_unavailable" ? 409 : 400 });
  }

  const o = data[0];
  const lines = items.map((i: any) => `${i.quantity} × ${names[i.scent_id] || i.scent_id}`);
  const name = String(b.name).trim(), email = String(b.email ?? "").trim(), phone = String(b.phone ?? "").trim(), notes = String(b.notes ?? "").trim();
  const text = [`New order ${o.ref} (${gbp(o.total_pence)})`, "", ...lines, "", `Name: ${name}`, `Email: ${email || "-"}`, `Phone: ${phone || "-"}`, `Notes: ${notes || "-"}`, "", "Manage it in the admin page: /admin"].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><h2 style="margin:0 0 8px">New order ${esc(o.ref)}</h2><p style="margin:0 0 14px">${gbp(o.total_pence)} · ${items.reduce((a: number, i: any) => a + i.quantity, 0)} snap bars</p><ul style="padding-left:18px">${lines.map((l: string) => `<li>${esc(l)}</li>`).join("")}</ul><p><b>${esc(name)}</b><br>Email: ${esc(email || "-")}<br>Phone: ${esc(phone || "-")}<br>Notes: ${esc(notes || "-")}</p><p style="color:#666">Stock has already been updated. Manage or cancel this order in the admin page.</p></div>`;
  await sendEmail(`New Florenti order ${o.ref}`, html, text, email || undefined);

  return NextResponse.json({ ok: true, ref: o.ref, totalPence: o.total_pence });
}
