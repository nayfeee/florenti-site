"use client";
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { downloadCsv, friendlyError, longDate, norm, pounds, shortDate, waNumber } from "@/lib/util";

const STATUSES = ["new", "paid", "making", "completed", "cancelled"];
type Order = { id: string; ref: string; customer_name: string; email: string; phone: string; notes: string; address_line1: string; address_line2: string; town: string; postcode: string; delivery_from: string | null; status: string; total_pence: number; created_at: string; order_items: { quantity: number; ml_per_bar: number; scents: { name: string } | null }[] };

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("orders").select("id,ref,customer_name,email,phone,notes,address_line1,address_line2,town,postcode,delivery_from,status,total_pence,created_at,order_items(quantity,ml_per_bar,scents(name))").order("created_at", { ascending: false }).limit(500);
    if (error) setMsg({ ok: false, text: friendlyError(error) }); else setOrders(data as any);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setOrderStatus(o: Order, s: string) {
    if (s === o.status) return;
    const { error } = await sb.rpc("set_order_status", { p_order_id: o.id, p_status: s });
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: `${o.ref} is now ${s}.` }); load();
  }
  async function cancel(o: Order) {
    if (!window.confirm(`Cancel ${o.ref} for ${o.customer_name}? The oil goes back into stock.`)) return;
    const { error } = await sb.rpc("cancel_order", { p_order_id: o.id, p_note: "" });
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: `${o.ref} cancelled and stock restored.` }); load();
  }

  const k = norm(q.trim());
  const list = (orders || []).filter((o) => (status === "all" || o.status === status) && (!k || norm([o.ref, o.customer_name, o.email, o.phone, o.notes, o.address_line1, o.town, o.postcode].join(" ")).includes(k)));
  const bars = (o: Order) => o.order_items.reduce((a, i) => a + i.quantity, 0);

  function exportCsv() {
    downloadCsv(`florenti-orders-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Reference", "Date", "Name", "Email", "Phone", "Address line 1", "Address line 2", "Town", "Postcode", "Delivery from", "Status", "Total", "Bars", "Items", "Notes"],
      ...(orders || []).map((o) => [o.ref, new Date(o.created_at).toLocaleString("en-GB"), o.customer_name, o.email, o.phone, o.address_line1, o.address_line2, o.town, o.postcode, o.delivery_from ?? "", o.status, (o.total_pence / 100).toFixed(2), bars(o), o.order_items.map((i) => `${i.quantity} x ${i.scents?.name}`).join("; "), o.notes]),
    ]);
  }

  return (
    <>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="oq">Search orders</label><input id="oq" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, reference, phone…" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="os">Status</label>
          <select id="os" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div>
        <button className="btn small" style={{ flex: "0 0 auto" }} onClick={exportCsv} disabled={!orders?.length}>Download CSV</button>
      </div>
      {msg && <div className={"notice " + (msg.ok ? "ok" : "err")} role="status">{msg.text}</div>}
      <p className="count" style={{ margin: "14px 0" }}>{orders === null ? "Loading…" : `${list.length} order${list.length === 1 ? "" : "s"}`}</p>
      {list.map((o) => (
        <details className="item" key={o.id}>
          <summary>
            <span><b style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 400 }}>{o.ref}</b> · {o.customer_name}<br /><span className="muted" style={{ fontSize: 13 }}>{new Date(o.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {bars(o)} bars · {pounds(o.total_pence)}{o.postcode ? ` · ${o.postcode}` : ""}</span></span>
            <span className={"pill " + o.status}>{o.status}</span>
          </summary>
          <div className="body">
            <ul className="sum" style={{ margin: "10px 0" }}>{o.order_items.map((i, n) => <li key={n}><span>{i.scents?.name}</span><span>× {i.quantity}</span></li>)}</ul>
            <p style={{ margin: "8px 0" }}>
              {o.phone && <><a href={`tel:${o.phone}`}>{o.phone}</a> · <a href={`https://wa.me/${waNumber(o.phone)}`} target="_blank" rel="noopener">WhatsApp</a><br /></>}
              {o.email && <a href={`mailto:${o.email}`}>{o.email}</a>}
            </p>
            {o.address_line1 && <p style={{ margin: "8px 0" }}><b>Deliver to</b><br />{[o.address_line1, o.address_line2, o.town, o.postcode].filter(Boolean).join(", ")}{o.delivery_from && <><br /><span className="muted">Delivery from {longDate(o.delivery_from)}</span></>}</p>}
            {o.notes && <p className="muted" style={{ margin: "8px 0" }}>Notes: {o.notes}</p>}
            {o.status !== "cancelled" ? (
              <>
                <div className="seg">{STATUSES.filter((s) => s !== "cancelled").map((s) => <button key={s} className="chip" aria-pressed={o.status === s} onClick={() => setOrderStatus(o, s)}>{s}</button>)}</div>
                <button className="btn danger small" onClick={() => cancel(o)}>Cancel order and restore stock</button>
              </>
            ) : <p className="muted">Cancelled. The oil was returned to stock.</p>}
          </div>
        </details>
      ))}
    </>
  );
}
