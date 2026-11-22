"use client";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import OrdersTab from "./OrdersTab";
import ScentsTab from "./ScentsTab";
import OfferTab from "./OfferTab";
import HistoryTab from "./HistoryTab";

const TABS = [["orders", "Orders"], ["scents", "Scents & stock"], ["offer", "Monthly offer"], ["history", "History"]] as const;

export default function AdminApp() {
  const [session, setSession] = useState<any>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<string>("orders");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(null); return; }
    // Only real admins can read this table, so a result means "you are an admin".
    sb.from("admin_users").select("user_id").limit(1).then(({ data, error }) => setIsAdmin(!error && !!data?.length));
  }, [session]);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr("That email or password didn’t work.");
    setBusy(false);
  }

  if (session === undefined) return <div className="adm"><p className="muted">Loading…</p></div>;

  if (!session) return (
    <div className="adm" style={{ maxWidth: 420, paddingTop: 70 }}>
      <h1 style={{ textAlign: "center" }}>Florenti</h1>
      <p className="lead" style={{ margin: "8px 0 22px" }}>Admin sign in</p>
      <form className="panel" onSubmit={login}>
        <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {err && <div className="notice err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );

  if (isAdmin === null) return <div className="adm"><p className="muted">Checking access…</p></div>;

  if (!isAdmin) return (
    <div className="adm" style={{ maxWidth: 480, paddingTop: 70 }}>
      <div className="notice err">This account isn’t set up as a Florenti admin.</div>
      <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );

  return (
    <div className="adm">
      <div className="adm-top">
        <h1>Florenti</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn small" href="/">View site</a>
          <button className="btn small" onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "orders" && <OrdersTab />}
      {tab === "scents" && <ScentsTab />}
      {tab === "offer" && <OfferTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
