import { test, expect } from "@playwright/test";

import { corridors } from "../../app/src/domain/corridors";
import { fetchCorridorTraffic } from "../../app/src/services/tomtom-routing";
import { tomtomTrafficFixture } from "../fixtures/traffic";

for (const corridor of corridors) {
  test(`${corridor.name}: the rendered map follows live geometry and falls back on failure`, async ({
    page,
  }) => {
    let available = false;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    // A fixed background isolates changes to the real MapLibre route rendering
    // from basemap tile loading and labels. Empty glyph tiles omit map labels.
    await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
      route.fulfill({
        json: {
          version: 8,
          glyphs:
            "https://tiles.openfreemap.org/test-glyphs/{fontstack}/{range}.pbf",
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#ffffff" },
            },
          ],
        },
      }),
    );
    await page.route("https://tiles.openfreemap.org/test-glyphs/**", (route) =>
      route.fulfill({ body: Buffer.alloc(0) }),
    );
    await page.route(`**/api/traffic/${corridor.id}`, async (route) => {
      if (!available)
        return route.fulfill({ status: 503, json: { status: "unavailable" } });

      const fixture = tomtomTrafficFixture(corridor.routes[0]);

      for (const point of fixture.routes[0].legs[0].points) {
        point.latitude += 0.0007;
        point.longitude += 0.0007;
      }

      const result = await fetchCorridorTraffic(
        corridor.routes[0],
        "test-only-key",
        new AbortController().signal,
        async () => Response.json(fixture),
      );

      await route.fulfill({ json: result });
    });

    const glyphLoaded = page.waitForResponse(
      "https://tiles.openfreemap.org/test-glyphs/**",
    );

    await page.clock.install();
    await page.goto("/");
    await page
      .getByRole("button", { name: corridor.name, exact: true })
      .press("Enter");
    await glyphLoaded;

    const traffic = page.getByRole("region", {
      name: `Tráfico de ${corridor.name}`,
    });

    // Compare only the exposed map, excluding the drawer, controls, and their
    // focus/transition states that overlap the full canvas screenshot.
    const captureRoute = () =>
      page.screenshot({ clip: { x: 250, y: 180, width: 800, height: 450 } });

    await expect(traffic.getByRole("alert")).toBeVisible();

    const fallbackView = await captureRoute();

    available = true;
    await page.clock.fastForward(121_000);
    await expect(traffic.getByRole("definition").first()).toHaveText("42 min");
    await expect
      .poll(async () => (await captureRoute()).equals(fallbackView))
      .toBe(false);

    available = false;
    await page.clock.fastForward(121_000);
    await expect(traffic.getByRole("alert")).toBeVisible();
    await expect(traffic.getByRole("definition")).toHaveCount(0);
    await expect
      .poll(async () => (await captureRoute()).equals(fallbackView))
      .toBe(true);
  });
}
