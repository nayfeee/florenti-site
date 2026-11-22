import SiteHeader from "@/components/SiteHeader";
import ScentMenu from "@/components/ScentMenu";
import WhatsAppButton from "@/components/WhatsAppButton";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = serverClient();
  const [scents, offer] = await Promise.all([
    db.from("public_scents").select("id,name,inspired_by,description,tags"),
    db.from("public_offer_scents").select("scent_id").limit(1),
  ]);
  const list = (scents.data || []).slice().sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return (
    <>
      <SiteHeader />
      <main>
        {offer.data && offer.data.length > 0 && (
          <a className="offer-link" href="/monthly-offer">View monthly snap bar offer</a>
        )}
        {scents.error ? <p className="empty">The scent list is taking a moment. Please try again shortly.</p> : <ScentMenu scents={list} />}
      </main>
      <footer className="site">
        <div className="mark">Florenti</div>
        <p>To order, send us a message on Facebook or WhatsApp.</p>
      </footer>
      <WhatsAppButton />
    </>
  );
}
