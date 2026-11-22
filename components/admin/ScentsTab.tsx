"use client";
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { TAGS, downloadCsv, friendlyError, norm } from "@/lib/util";

const ML_PER_BAR = 5;
const LOW_ML = 50; // "low" = less than one 10-bar box worth
type Scent = { id: string; name: string; inspired_by: string; description: string; tags: string[]; stock_ml: number; active: boolean };
type Msg = { ok: boolean; text: string } | null;

const TYPES: [string, string][] = [["add", "Add stock (new oil)"], ["remove", "Remove stock"], ["fair", "Fair / market sale"], ["offline", "Offline order (e.g. Facebook)"], ["exact", "Set exact level (stocktake)"]];

function TagPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="seg">{TAGS.map((t) => <button type="button" key={t} className="chip" aria-pressed={value.includes(t)} onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}>{t}</button>)}</div>
  );
}

function ScentPanel({ s, done }: { s: Scent; done: (m: Msg) => void }) {
  const [type, setType] = useState("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState(s.name);
  const [by, setBy] = useState(s.inspired_by);
  const [desc, setDesc] = useState(s.description);
  const [tags, setTags] = useState<string[]>(s.tags);
  const [active, setActive] = useState(s.active);

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n < 0 || (type !== "exact" && n === 0)) return done({ ok: false, text: "Enter an amount in ml." });
    let delta = n, reason = "manual_add";
    if (type === "remove") { delta = -n; reason = "manual_remove"; }
    if (type === "fair") { delta = -n; reason = "fair"; }
    if (type === "offline") { delta = -n; reason = "offline_order"; }
    if (type === "exact") { delta = n - s.stock_ml; reason = "correction"; if (delta === 0) return done({ ok: true, text: `${s.name} is already at ${n} ml.` }); }
    const { error } = await sb.rpc("adjust_stock", { p_scent_id: s.id, p_delta_ml: delta, p_reason: reason, p_note: note });
    done(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: `${s.name}: ${delta > 0 ? "+" : ""}${delta} ml saved.` });
    if (!error) { setAmount(""); setNote(""); }
  }
  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await sb.from("scents").update({ name: name.trim(), inspired_by: by.trim(), description: desc.trim(), tags, active }).eq("id", s.id);
    done(error ? { ok: false, text: error.code === "23505" ? "A scent with that name already exists." : friendlyError(error) } : { ok: true, text: `${name.trim()} saved.` });
  }
  return (
    <div className="body">
      <form onSubmit={adjust}>
        <h3 className="label" style={{ margin: "14px 0 8px" }}>Change stock</h3>
        <div className="row">
          <div className="field"><label htmlFor={`t${s.id}`}>What happened?</label><select id={`t${s.id}`} value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor={`a${s.id}`}>{type === "exact" ? "Exact ml now" : "Amount (ml)"}</label><input id={`a${s.id}`} type="number" inputMode="numeric" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "exact" ? String(s.stock_ml) : "e.g. 50"} /></div>
        </div>
        <div className="field"><label htmlFor={`n${s.id}`}>Note (optional)</label><input id={`n${s.id}`} type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Saturday craft fair" /></div>
        <button className="btn primary small">Save stock change</button>
      </form>
      <form onSubmit={saveDetails}>
        <h3 className="label" style={{ margin: "26px 0 8px" }}>Scent details</h3>
        <div className="field"><label>Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label>Inspired by</label><input type="text" value={by} onChange={(e) => setBy(e.target.value)} /></div>
        <div className="field"><label>Description</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="field"><span className="label">Categories</span><TagPicker value={tags} onChange={setTags} /></div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0 14px" }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={active} onChange={(e) => setActive(e.target.checked)} /> Show on the website</label>
        <button className="btn small">Save details</button>
      </form>
    </div>
  );
}

function AddScent({ done, onClose }: { done: (m: Msg) => void; onClose: () => void }) {
  const [name, setName] = useState(""); const [by, setBy] = useState(""); const [desc, setDesc] = useState("");
  const [tags, setTags] = useState<string[]>([]); const [ml, setMl] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await sb.from("scents").insert({ name: name.trim(), inspired_by: by.trim(), description: desc.trim(), tags, active: true }).select("id").single();
    if (error) return done({ ok: false, text: error.code === "23505" ? "A scent with that name already exists." : friendlyError(error) });
    const n = Math.round(Number(ml));
    if (n > 0) {
      const r = await sb.rpc("adjust_stock", { p_scent_id: data.id, p_delta_ml: n, p_reason: "manual_add", p_note: "Starting stock" });
      if (r.error) return done({ ok: false, text: `${name.trim()} was added, but the stock failed: ${friendlyError(r.error)}` });
    }
    done({ ok: true, text: `${name.trim()} added${n > 0 ? ` with ${n} ml` : " (no stock yet, so it stays hidden)"}.` }); onClose();
  }
  return (
    <form className="panel" onSubmit={add}>
      <h3 className="label" style={{ margin: 0 }}>Add a new scent</h3>
      <div className="field" style={{ marginTop: 12 }}><label>Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="field"><label>Inspired by (optional)</label><input type="text" value={by} onChange={(e) => setBy(e.target.value)} /></div>
      <div className="field"><label>Description</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="field"><span className="label">Categories</span><TagPicker value={tags} onChange={setTags} /></div>
      <div className="field"><label>Starting stock (ml)</label><input type="number" inputMode="numeric" min={0} value={ml} onChange={(e) => setMl(e.target.value)} placeholder="e.g. 100" /></div>
      <div style={{ display: "flex", gap: 10 }}><button className="btn primary small">Add scent</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

export default function ScentsTab() {
  const [scents, setScents] = useState<Scent[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("scents").select("id,name,inspired_by,description,tags,stock_ml,active").order("name");
    if (error) setMsg({ ok: false, text: friendlyError(error) }); else setScents((data as Scent[]).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })));
  }, []);
  useEffect(() => { load(); }, [load]);
  const done = (m: Msg) => { setMsg(m); load(); };

  const all = scents || [];
  const out = all.filter((s) => s.stock_ml < ML_PER_BAR), low = all.filter((s) => s.stock_ml >= ML_PER_BAR && s.stock_ml <= LOW_ML);
  const k = norm(q.trim());
  const list = all.filter((s) => (filter === "all" || (filter === "low" && low.includes(s)) || (filter === "out" && out.includes(s)) || (filter === "hidden" && !s.active)) && (!k || norm(s.name + " " + s.inspired_by).includes(k)));

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{all.length}</b><span>Scents</span></div>
        <div className="stat"><b>{(all.reduce((a, s) => a + s.stock_ml, 0) / 1000).toFixed(2)} L</b><span>Oil in stock</span></div>
        <div className="stat"><b>{low.length}</b><span>Low (≤{LOW_ML} ml)</span></div>
        <div className="stat"><b>{out.length}</b><span>Out of stock</span></div>
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="sq">Search scents</label><input id="sq" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or brand…" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="sf">Show</label>
          <select id="sf" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All scents</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="hidden">Hidden from website</option></select></div>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
        <button className="btn primary small" onClick={() => setAdding(true)}>+ Add new scent</button>
        <button className="btn small" disabled={!scents} onClick={() => downloadCsv(`florenti-stock-${new Date().toISOString().slice(0, 10)}.csv`, [["Scent", "Inspired by", "Stock (ml)", "Bars left", "On website", "Categories"], ...all.map((s) => [s.name, s.inspired_by, s.stock_ml, Math.floor(s.stock_ml / ML_PER_BAR), s.active && s.stock_ml >= ML_PER_BAR ? "Yes" : "No", s.tags.join("; ")])])}>Download stock CSV</button>
      </div>
      {adding && <AddScent done={done} onClose={() => setAdding(false)} />}
      {msg && <div className={"notice " + (msg.ok ? "ok" : "err")} role="status">{msg.text}</div>}
      <p className="count" style={{ margin: "14px 0" }}>{scents === null ? "Loading…" : `${list.length} scent${list.length === 1 ? "" : "s"}`}</p>
      {list.map((s) => (
        <details className="item" key={s.id}>
          <summary>
            <span><b style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 400 }}>{s.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{s.stock_ml} ml · {Math.floor(s.stock_ml / ML_PER_BAR)} bars</span></span>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!s.active && <span className="pill">hidden</span>}
              {s.stock_ml < ML_PER_BAR ? <span className="pill out">out</span> : s.stock_ml <= LOW_ML ? <span className="pill low">low</span> : null}
            </span>
          </summary>
          <ScentPanel s={s} done={done} />
        </details>
      ))}
    </>
  );
}
