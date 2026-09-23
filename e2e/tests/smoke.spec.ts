import { test, expect } from "@playwright/test";

test("the map responds to zoom and pan", async ({ page }) => {
  const tileLoaded = page.waitForResponse(
    (response) =>
      response.url().startsWith("https://tiles.openfreemap.org/planet/") &&
      response.url().endsWith(".pbf") &&
      response.ok(),
  );

  await page.goto("/");
  await tileLoaded;

  const map = page.getByRole("region", {
    name: "Mapa interactivo de Lima, Perú",
  });

  const canvas = map.locator("canvas");

  await expect(map.getByText("OpenStreetMap")).toBeVisible();

  const initialView = await canvas.screenshot();

  await map.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(initialView))
    .toBe(false);

  const zoomedView = await canvas.screenshot();
  const bounds = await canvas.boundingBox();

  if (!bounds) throw new Error("Map canvas is not visible");

  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await canvas.screenshot()).equals(zoomedView))
    .toBe(false);
});

test("the Stellar debug route remains available", async ({ page }) => {
  await page.goto("/debug");
  await expect(
    page.getByText("Contract Explorer", { exact: true }),
  ).toBeVisible();
});
