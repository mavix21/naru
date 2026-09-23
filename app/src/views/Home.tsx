import LimaMap from "../components/map/LimaMap";

const Home = () => (
  <section className="relative h-dvh min-h-80 overflow-hidden bg-muted">
    <LimaMap />
    <header className="pointer-events-none absolute top-4 left-4 z-10 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:top-6 sm:left-6">
      <h1 className="text-xl font-semibold tracking-tight">Pulso</h1>
      <p className="text-xs text-muted-foreground">Lima, Perú</p>
    </header>
  </section>
);

export default Home;
