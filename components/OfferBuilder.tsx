"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TAGS, WHATSAPP, longDate, norm, pounds, waLink } from "@/lib/util";

export type OfferScent = { scent_id: string; name: string; inspired_by: string; description: string; tags: string[]; max_bars: number };
export type Offer = { id: string; name: string; bars_per_box: number; price_pence: number; delivery_from?: string | null };

export default function OfferBuilder({ offer, scents }: { offer: Offer; scents: OfferScent[] }) {
  const router = useRouter();
  const bars = offer.bars_per_box;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("All");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [town, setTown] = useState("");
  const [postcode, setPostcode] = useState("");
  const [pcWarn, setPcWarn] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: real people never fill this in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ ref: string; name: string; deliveryFrom: string | null; lines: { name: string; qty: number }[] } | null>(null);

  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const byId = useMemo(() => Object.fromEntries(scents.map((s) => [s.scent_id, s])), [scents]);

  // If stock changed while the page was open, trim the basket to what is still available.
  useEffect(() => {
    setQty((prev) => {
      const next: Record<string, number> = {};
      for (const s of scents) { const v = Math.min(prev[s.scent_id] || 0, s.max_bars); if (v > 0) next[s.scent_id] = v; }
      return next;
    });
  }, [scents]);

  function change(id: string, delta: number) {
    setQty((prev) => {
      const s = byId[id]; const cur = prev[id] || 0; const nv = cur + delta;
      const t = Object.values(prev).reduce((a, b) => a + b, 0) + delta;
      if (!s || nv < 0 || nv > s.max_bars || t > bars) return prev;
      const next = { ...prev }; if (nv === 0) delete next[id]; else next[id] = nv; return next;
    });
  }

  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  const shown = scents.filter((s) => (tag === "All" || s.tags.includes(tag)) && words.every((w) => norm([s.name, s.inspired_by, s.description, s.tags.join(" ")].join(" ")).includes(w)));
  const presentTags = TAGS.filter((t) => scents.some((s) => s.tags.includes(t)));
  const chosen = scents.filter((s) => qty[s.scent_id] > 0);
  const hasContact = email.includes("@") || phone.replace(/\D/g, "").length >= 7;
  const pcShape = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]?\s*[0-9][A-Za-z]{2}$/.test(postcode.trim());
  const canSubmit = total === bars && name.trim().length >= 2 && hasContact && address1.trim().length >= 3 && town.trim().length >= 2 && pcShape && !busy;

  // Friendly, optional check against the free postcodes.io service. It never blocks an order and stays quiet if the service is down.
  async function checkPostcode() {
    setPcWarn("");
    const p = postcode.replace(/\s+/g, "");
    if (!pcShape) { if (p) setPcWarn("That doesn’t look like a UK postcode. Please check it."); return; }
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(p)}/validate`, { signal: ctrl.signal }); clearTimeout(t);
      const j = await r.json();
      if (j?.result === false) setPcWarn("We couldn’t find that postcode. Please double-check it (you can still place your order).");
    } catch { /* service unavailable: say nothing */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError("");
    const items = Object.entries(qty).filter(([, v]) => v > 0).map(([id, v]) => ({ scent_id: id, quantity: v }));
    try {
      const res = await fetch("/api/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offerId: offer.id, items, name, email, phone, notes, website, address1, address2, town, postcode }) });
      const j = await res.json();
      if (j.ok) {
        setDone({ ref: j.ref, name: name.trim(), deliveryFrom: j.deliveryFrom ?? null, lines: chosen.map((s) => ({ name: s.name, qty: qty[s.scent_id] })) });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setError(j.message || "Something went wrong. Please try again.");
        if (["insufficient_stock", "scent_unavailable", "offer_unavailable"].includes(j.code)) router.refresh();
      }
    } catch {
      setError("We couldn’t reach the server. Please check your connection and try again.");
    } finally { setBusy(false); }
  }

  if (done) {
    const msg = `Hi Florenti! I’ve just placed order ${done.ref} on the website.\n\n${done.lines.map((l) => `${l.qty} x ${l.name}`).join("\n")}${done.deliveryFrom ? `\n\nDelivery from ${longDate(done.deliveryFrom)}` : ""}\n\nName: ${done.name}`;
    return (
      <div className="panel narrow" style={{ margin: "20px auto" }}>
        <p className="lead">Thank you, {done.name.split(" ")[0]}</p>
        <p className="ref">{done.ref}</p>
        <p className="muted" style={{ textAlign: "center", marginTop: 0 }}>Your order has been received. Keep this reference number handy. We’ll be in touch shortly to confirm everything and arrange payment.</p>
        {done.deliveryFrom && <p className="muted" style={{ textAlign: "center", fontWeight: 600 }}>Delivery will be from {longDate(done.deliveryFrom)}</p>}
        <ul className="sum" style={{ margin: "18px 0" }}>
          {done.lines.map((l) => <li key={l.name}><span>{l.name}</span><span>× {l.qty}</span></li>)}
        </ul>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <a className="btn primary" href={waLink(WHATSAPP, msg)} target="_blank" rel="noopener">Message us on WhatsApp too</a>
          <a className="btn" href="/">Back to the scents</a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="offer-head">
        <h2>{offer.name}</h2>
        <p>{pounds(offer.price_pence)} for {bars} snap bars. Mix and match any scents below, and pick the same one more than once if you love it.</p>
        {offer.delivery_from && <p className="delivery">Delivery will be from {longDate(offer.delivery_from)}</p>}
      </div>
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this month’s scents…" aria-label="Search scents" autoComplete="off" />
      {presentTags.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by scent type">
          {["All", ...presentTags].map((t) => <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>{t}</button>)}
        </div>
      )}
      <div className="list">
        {shown.length === 0 && <p className="empty">No scents found. Try another word or filter.</p>}
        {shown.map((s) => {
          const n = qty[s.scent_id] || 0;
          return (
            <div className={"pick" + (n > 0 ? " on" : "")} key={s.scent_id}>
              <div className="info">
                <h3>{s.name}</h3>
                {s.inspired_by && <p className="by">Inspired by {s.inspired_by}</p>}
                {s.description && <p className="desc">{s.description}</p>}
              </div>
              <div className="step">
                <button type="button" onClick={() => change(s.scent_id, -1)} disabled={n === 0} aria-label={`Remove one ${s.name}`}>−</button>
                <output aria-live="polite">{n}</output>
                <button type="button" onClick={() => change(s.scent_id, 1)} disabled={total >= bars || n >= s.max_bars} aria-label={`Add one ${s.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="basketbar">
        <div className="txt">
          <strong>{total} / {bars} bars</strong>
          <div className="bar"><i style={{ width: `${(total / bars) * 100}%` }} /></div>
        </div>
        {total === bars ? <a className="btn primary small" href="#details">Continue</a> : <span className="muted">{bars - total} to go</span>}
      </div>

      <form id="details" onSubmit={submit} className="panel">
        <h2 className="section" style={{ marginTop: 0 }}>What's in your bag?</h2>
        {chosen.length === 0 ? <p className="muted">Nothing chosen yet. Pick your {bars} bars above.</p> : (
          <ul className="sum">{chosen.map((s) => <li key={s.scent_id}><span>{s.name}</span><span>× {qty[s.scent_id]}</span></li>)}</ul>
        )}
        <h2 className="section">Your details</h2>
        <div className="field"><label htmlFor="n">Name</label><input id="n" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} required /></div>
        <div className="row">
          <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} /></div>
          <div className="field"><label htmlFor="p">Phone / WhatsApp</label><input id="p" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} /></div>
        </div>
        <p className="muted" style={{ marginTop: -6, fontSize: 14 }}>Please give an email, a phone number, or both, so we can reach you.</p>
        <h2 className="section">Delivery address</h2>
        <div className="field"><label htmlFor="a1">House number and street</label><input id="a1" type="text" value={address1} onChange={(e) => setAddress1(e.target.value)} autoComplete="address-line1" maxLength={150} placeholder="e.g. 39 Rodney Drive" required /></div>
        <div className="field"><label htmlFor="a2">Flat, area or extra line (optional)</label><input id="a2" type="text" value={address2} onChange={(e) => setAddress2(e.target.value)} autoComplete="address-line2" maxLength={150} /></div>
        <div className="row">
          <div className="field"><label htmlFor="t">Town or city</label><input id="t" type="text" value={town} onChange={(e) => setTown(e.target.value)} autoComplete="address-level2" maxLength={80} required /></div>
          <div className="field"><label htmlFor="pc">Postcode</label><input id="pc" type="text" value={postcode} onChange={(e) => { setPostcode(e.target.value); setPcWarn(""); }} onBlur={checkPostcode} autoComplete="postal-code" maxLength={10} required style={{ textTransform: "uppercase" }} /></div>
        </div>
        {pcWarn && <p className="muted" role="status" style={{ marginTop: -6, fontSize: 14, color: "#f3d9a4" }}>{pcWarn}</p>}
        {offer.delivery_from && <p className="delivery">Delivery will be from {longDate(offer.delivery_from)}</p>}
        <div className="field"><label htmlFor="o">Notes (safe place for delivery etc.)</label><textarea id="o" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Anything we should know?" /></div>
        <div className="hp" aria-hidden="true"><label>Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
        {error && <div className="notice err" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={!canSubmit} style={{ width: "100%" }}>{busy ? "Placing order…" : `Place order · ${pounds(offer.price_pence)}`}</button>
        <p className="muted" style={{ fontSize: 14, textAlign: "center", marginBottom: 0 }}>{total !== bars ? `Choose exactly ${bars} bars to continue.` : "No payment now. We’ll be in touch to confirm your order and arrange payment."}</p>
      </form>
    </>
  );
}
