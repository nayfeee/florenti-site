"use client";
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { friendlyError, norm, pounds } from "@/lib/util";

type Offer = { id: string; name: string; bars_per_box: number; price_pence: number; ml_per_bar: number; active: boolean };
type Sc = { id: string; name: string; stock_ml: number; active: boolean };
type Msg = { ok: boolean; text: string } | null;

export default function OfferTab() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [links, setLinks] = useState<{ offer_id: string; scent_id: string }[]>([]);
  const [scents, setScents] = useState<Sc[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<string | null>(null); // offer id, "new", or null
  const [name, setName] = useState(""); const [price, setPrice] = useState("20"); const [bars, setBars] = useState("10"); const [ml, setMl] = useState("5");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [o, l, s] = await Promise.all([
      sb.from("offers").select("id,name,bars_per_box,price_pence,ml_per_bar,active").order("created_at", { ascending: false }),
      sb.from("offer_scents").select("offer_id,scent_id"),
      sb.from("scents").select("id,name,stock_ml,active").order("name"),
    ]);
    const e = o.error || l.error || s.error; if (e) setMsg({ ok: false, text: friendlyError(e) });
    setOffers((o.data as Offer[]) || []); setLinks(l.data || []); setScents(((s.data as Sc[]) || []).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })));
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(o: Offer | null) {
    setMsg(null); setQ("");
    if (!o) { setEditing("new"); setName(""); setPrice("20"); setBars("10"); setMl("5"); setSel(new Set()); }
    else { setEditing(o.id); setName(o.name); setPrice(String(o.price_pence / 100)); setBars(String(o.bars_per_box)); setMl(String(o.ml_per_bar)); setSel(new Set(links.filter((l) => l.offer_id === o.id).map((l) => l.scent_id))); }
    setTimeout(() => document.getElementById("offer-form")?.scrollIntoView({ behavior: "smooth" }), 50);
  }
  async function save(activate: boolean) {
    const p = Math.round(parseFloat(price) * 100), b = parseInt(bars, 10), m = parseInt(ml, 10);
    if (!name.trim()) return setMsg({ ok: false, text: "Give the offer a name." });
    if (!(p >= 0) || !(b >= 1) || !(m >= 1)) return setMsg({ ok: false, text: "Check the price, number of bars and ml per bar." });
    if (activate && sel.size === 0) return setMsg({ ok: false, text: "Pick at least one scent before making it live." });
    const { error } = await sb.rpc("save_offer", { p_offer_id: editing === "new" ? null : editing, p_name: name, p_bars: b, p_price_pence: p, p_ml_per_bar: m, p_scent_ids: [...sel], p_activate: activate });
    if (error) return setMsg({ ok: false, text: friendlyError(error) });
    setMsg({ ok: true, text: activate ? `${name.trim()} is now live on the website.` : `${name.trim()} saved.` }); setEditing(null); load();
  }
  async function setActive(o: Offer, active: boolean) {
    const { error } = await sb.rpc("set_offer_active", { p_offer_id: o.id, p_active: active });
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: active ? `${o.name} is now live (any other offer was switched off).` : `${o.name} has ended.` }); load();
  }

  const mlNum = parseInt(ml, 10) || 5;
  const k = norm(q.trim());
  const pickable = scents.filter((s) => (s.active && s.stock_ml >= mlNum) || sel.has(s.id)).filter((s) => !k || norm(s.name).includes(k));
  const inStockIds = scents.filter((s) => s.active && s.stock_ml >= mlNum).map((s) => s.id);
  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <p className="muted">Only one offer is live at a time. Scents that run out disappear from the live offer by themselves, and the new month’s picker only lists scents that still have stock.</p>
      <button className="btn primary small" onClick={() => edit(null)}>+ Start a new monthly offer</button>
      {msg && <div className={"notice " + (msg.ok ? "ok" : "err")} role="status">{msg.text}</div>}

      <div style={{ marginTop: 18 }}>
        {offers === null && <p className="muted">Loading…</p>}
        {offers?.map((o) => {
          const ids = links.filter((l) => l.offer_id === o.id).map((l) => l.scent_id);
          const available = ids.filter((id) => scents.find((s) => s.id === id && s.active && s.stock_ml >= o.ml_per_bar)).length;
          return (
            <div className="item" key={o.id}><div className="head" style={{ cursor: "default", flexWrap: "wrap" }}>
              <span><b style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 400 }}>{o.name}</b> {o.active && <span className="pill completed">live</span>}<br />
                <span className="muted" style={{ fontSize: 13 }}>{pounds(o.price_pence)} for {o.bars_per_box} bars · {o.ml_per_bar} ml per bar · {ids.length} scents{o.active ? ` (${available} still available)` : ""}</span></span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="btn small" onClick={() => edit(o)}>Edit</button>
                {o.active ? <button className="btn small danger" onClick={() => setActive(o, false)}>End offer</button> : <button className="btn small primary" onClick={() => setActive(o, true)}>Make live</button>}
              </span>
            </div></div>
          );
        })}
      </div>

      {editing && (
        <div className="panel" id="offer-form">
          <h3 className="label" style={{ margin: 0 }}>{editing === "new" ? "New offer" : "Edit offer"}</h3>
          <div className="field" style={{ marginTop: 12 }}><label>Offer name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. December Selection Box" /></div>
          <div className="row">
            <div className="field"><label>Price (£)</label><input type="number" inputMode="decimal" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="field"><label>Bars per box</label><input type="number" inputMode="numeric" min="1" value={bars} onChange={(e) => setBars(e.target.value)} /></div>
            <div className="field"><label>Oil per bar (ml)</label><input type="number" inputMode="numeric" min="1" value={ml} onChange={(e) => setMl(e.target.value)} /></div>
          </div>
          <span className="label">Scents in this offer ({sel.size} picked)</span>
          <div className="row" style={{ margin: "8px 0", alignItems: "center" }}>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scents…" aria-label="Search scents" />
            <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
              <button type="button" className="btn small" onClick={() => setSel(new Set(inStockIds))}>All in stock</button>
              <button type="button" className="btn small" onClick={() => setSel(new Set())}>Clear</button>
            </div>
          </div>
          <div className="scroll">
            {pickable.map((s) => (
              <label className="pickrow" key={s.id}>
                <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="n">{s.name}</span>
                <span className="ml">{s.stock_ml} ml{s.stock_ml < mlNum ? " · out" : ""}</span>
              </label>
            ))}
            {pickable.length === 0 && <p className="muted">No scents match.</p>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="btn primary small" onClick={() => save(true)}>Save and make live</button>
            <button className="btn small" onClick={() => save(false)}>Save as draft</button>
            <button className="btn small" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
