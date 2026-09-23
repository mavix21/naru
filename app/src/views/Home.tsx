import LimaMap from "../components/map/LimaMap";
import { corridors } from "../domain/corridors";

const Home = () => (
  <section className="relative h-dvh min-h-80 overflow-hidden bg-muted">
    <LimaMap />
    <header className="pointer-events-none absolute top-4 left-4 z-10 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:top-6 sm:left-6">
      <h1 className="text-xl font-semibold tracking-tight">Pulso</h1>
      <p className="text-xs text-muted-foreground">Lima, Perú</p>
    </header>
    <aside
      aria-labelledby="corridors-heading"
      className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:bottom-6 sm:left-6"
    >
      <h2 id="corridors-heading" className="text-sm font-semibold">
        Corredores
      </h2>
      <ul className="mt-2 space-y-2 text-sm">
        {corridors.flatMap((corridor) =>
          corridor.routes.map((route) => (
            <li key={route.id}>
              <span className="block font-medium">{corridor.name}</span>
              <span className="text-xs text-muted-foreground">
                {route.direction} · {route.origin} → {route.destination}
              </span>
            </li>
          )),
        )}
      </ul>
    </aside>
  </section>
);

export default Home;
