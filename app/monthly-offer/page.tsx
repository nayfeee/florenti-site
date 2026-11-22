import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import OfferBuilder from "@/components/OfferBuilder";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Monthly snap bar offer | Florenti",
  description: "This month’s Florenti snap bar selection box. Choose your scents and order.",
  alternates: { canonical: "/monthly-offer" },
  openGraph: { url: "/monthly-offer", title: "Florenti | Monthly snap bar offer", description: "Build your own box of snap bars from this month’s selection.", images: [{ url: "/og-image.jpg", width: 1200, height: 630 }] },
};

export default async function MonthlyOffer() {
  const db = serverClient();
  const { data: offers } = await db.from("public_offers").select("id,name,bars_per_box,price_pence").limit(1);
  const offer = offers?.[0];
  const scents = offer
    ? (await db.from("public_offer_scents").select("scent_id,name,inspired_by,description,tags,max_bars").eq("offer_id", offer.id)).data || []
    : [];
  const sorted = scents.slice().sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return (
    <>
      <SiteHeader sub="The monthly snap bar offer" />
      <main className="narrow">
        {offer && sorted.length > 0 ? (
          <OfferBuilder offer={offer} scents={sorted} />
        ) : (
          <div className="panel" style={{ textAlign: "center" }}>
            <p className="lead">There’s no offer running right now.</p>
            <p className="muted">This month’s selection is being prepared. Have a look at the full collection in the meantime.</p>
            <a className="btn primary" href="/">Browse the scents</a>
          </div>
        )}
        <p style={{ textAlign: "center", marginTop: 30 }}><a className="btn small" href="/">← All scents</a></p>
      </main>
    </>
  );
}
