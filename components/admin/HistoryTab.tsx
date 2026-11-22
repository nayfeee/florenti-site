"use client";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { downloadCsv, friendlyError, norm } from "@/lib/util";

export const REASONS: Record<string, string> = { initial: "Starting stock", order: "Website order", order_cancelled: "Order cancelled", manual_add: "Stock added", manual_remove: "Stock removed", fair: "Fair / market", offline_order: "Offline order", correction: "Correction" };
type Mv = { id: number; created_at: string; delta_ml: number; reason: string; note: string; scents: { name: string } | null; orders: { ref: string } | null };

export default function HistoryTab() {
  const [rows, setRows] = useState<Mv[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    sb.from("inventory_movements").select("id,created_at,delta_ml,reason,note,scents(name),orders(ref)").order("id", { ascending: false }).limit(1000)
      .then(({ data, error }) => error ? setErr(friendlyError(error)) : setRows(data as any));
  }, []);
  const k = norm(q.trim());
  const list = (rows || []).filter((m) => !k || norm([m.scents?.name, m.orders?.ref, m.note, REASONS[m.reason]].join(" ")).includes(k));
  return (
    <>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="hq">Search history</label><input id="hq" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scent, order reference, note…" /></div>
        <button className="btn small" style={{ flex: "0 0 auto" }} disabled={!rows?.length} onClick={() => downloadCsv(`florenti-stock-history-${new Date().toISOString().slice(0, 10)}.csv`, [["Date", "Scent", "Change (ml)", "Reason", "Order", "Note"], ...(rows || []).map((m) => [new Date(m.created_at).toLocaleString("en-GB"), m.scents?.name, m.delta_ml, REASONS[m.reason] || m.reason, m.orders?.ref, m.note])])}>Download CSV</button>
      </div>
      {err && <div className="notice err">{err}</div>}
      <p className="count" style={{ margin: "14px 0" }}>{rows === null ? "Loading…" : `Showing the latest ${list.length} changes`}</p>
      {list.map((m) => (
        <div className="item" key={m.id}><div className="head" style={{ cursor: "default" }}>
          <span><b style={{ fontWeight: 400 }}>{m.scents?.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{new Date(m.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {REASONS[m.reason] || m.reason}{m.orders?.ref ? ` · ${m.orders.ref}` : ""}{m.note ? ` · ${m.note}` : ""}</span></span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 22, color: m.delta_ml < 0 ? "var(--danger)" : "var(--ok)" }}>{m.delta_ml > 0 ? "+" : ""}{m.delta_ml} ml</span>
        </div></div>
      ))}
    </>
  );
}
