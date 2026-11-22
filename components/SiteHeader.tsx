export default function SiteHeader({ sub = "The fragrance collection" }: { sub?: string }) {
  return (
    <header className="site">
      <h1 className="mark"><a href="/">Florenti</a></h1>
      <p className="sub">{sub}</p>
      <div className="rule"><i></i></div>
    </header>
  );
}
