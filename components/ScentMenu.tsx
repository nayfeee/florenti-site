"use client";
import { useMemo, useState } from "react";
import { TAGS, norm } from "@/lib/util";

export type Scent = { id: string; name: string; inspired_by: string; description: string; tags: string[] };

export default function ScentMenu({ scents }: { scents: Scent[] }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("All");
  const keyed = useMemo(() => scents.map((s) => ({ s, k: norm([s.name, s.inspired_by, s.description, s.tags.join(" ")].join(" ")) })), [scents]);
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  const list = keyed.filter(({ s, k }) => (tag === "All" || s.tags.includes(tag)) && words.every((w) => k.includes(w))).map((x) => x.s);

  return (
    <>
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scents, notes or brands…" aria-label="Search scents" autoComplete="off" />
      <div className="chips" role="group" aria-label="Filter by scent type">
        {["All", ...TAGS].map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>{t}</button>
        ))}
      </div>
      <p className="count" aria-live="polite">{list.length === scents.length ? `${scents.length} scents` : `${list.length} of ${scents.length} scents`}</p>
      <div className="grid">
        {list.length === 0 && <p className="empty">No scents found. Try another word or filter.</p>}
        {list.map((s) => (
          <article className="card" key={s.id}>
            <h2>{s.name}</h2>
            {s.inspired_by && <p className="by">Inspired by {s.inspired_by}</p>}
            {s.description && <p className="desc">{s.description}</p>}
            <div className="tags">{s.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
          </article>
        ))}
      </div>
    </>
  );
}
