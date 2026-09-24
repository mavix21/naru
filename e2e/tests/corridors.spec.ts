import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`corridors focus the map and update the drawer at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/traffic/*", (route) =>
      route.fulfill({
        status: 503,
        json: { status: "unavailable" },
      }),
    );

    const tileLoaded = page.waitForResponse(
      (response) =>
        response.url().startsWith("https://tiles.openfreemap.org/planet/") &&
        response.url().endsWith(".pbf") &&
        response.ok(),
    );

    await page.goto("/");
    await tileLoaded;

    const selector = page.getByRole("navigation", { name: "Corredores" });

    const map = page.getByRole("region", {
      name: "Mapa interactivo de Lima, Perú",
    });

    const canvas = map.locator("canvas");
    const initialView = await canvas.screenshot();
    const navigations: string[] = [];

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    await selector.getByRole("button", { name: "Avenida Arequipa" }).click();

    const drawer = page.getByRole("dialog");

    await expect(drawer).toBeVisible();

    const drawerWidth = viewport.width < 640 ? viewport.width / 2 : 320;

    await expect
      .poll(
        async () =>
          (await page.locator('[data-slot="drawer-popup"]').boundingBox())?.x,
      )
      .toBeLessThanOrEqual(viewport.width - drawerWidth + 1);

    const panel = await page
      .locator('[data-slot="drawer-popup"]')
      .boundingBox();

    if (!panel) throw new Error("Corridor drawer is not visible");

    expect(panel.x).toBeGreaterThan(viewport.width * 0.45);
    expect(panel.width).toBeLessThanOrEqual(viewport.width * 0.55);

    await expect
      .poll(async () => (await canvas.screenshot()).equals(initialView))
      .toBe(false);

    const zoomButton = map.getByRole("button", { name: "Zoom in" });
    const zoomPosition = await zoomButton.boundingBox();

    if (!zoomPosition) throw new Error("Map zoom control is not visible");

    expect(zoomPosition.x + zoomPosition.width).toBeLessThan(panel.x);
    await zoomButton.click();
    await expect(drawer).toBeVisible();

    await expect(drawer).toContainText("Avenida Arequipa");
    await expect(drawer).toContainText("Norte → sur");
    await expect(drawer).toContainText("Av. 28 de Julio");
    await expect(drawer).toContainText("Óvalo de Miraflores");
    await expect(
      selector.getByRole("button", { name: "Avenida Arequipa" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Also exercise keyboard selection; the dev-server badge overlaps this
    // bottom-left control when Playwright disables browser caching.
    await selector.getByRole("button", { name: "Vía Expresa" }).press("Enter");
    await expect(drawer).toContainText("Vía Expresa");
    await expect(drawer).toContainText("Av. Benavides");
    await expect(
      selector.getByRole("button", { name: "Vía Expresa" }),
    ).toHaveAttribute("aria-pressed", "true");

    await drawer.getByRole("button", { name: "Cerrar detalles" }).click();
    await expect(drawer).not.toBeVisible();
    await expect(
      selector.getByRole("button", { name: "Vía Expresa" }),
    ).toHaveAttribute("aria-pressed", "true");

    await selector.getByRole("button", { name: "Javier Prado" }).click();
    await expect(page.getByRole("dialog")).toContainText("Óvalo Monitor");
    expect(navigations).toHaveLength(0);
  });
}
