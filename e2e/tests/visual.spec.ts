import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the map fills the ${viewport.width}px viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const map = page.getByRole("region", {
      name: "Mapa interactivo de Lima, Perú",
    });

    await expect(map).toHaveCSS("width", `${viewport.width}px`);
    await expect(map).toHaveCSS("height", `${viewport.height}px`);
    await expect(page.getByRole("heading", { name: "Pulso" })).toBeVisible();
    await expect(map.getByRole("button", { name: "Zoom in" })).toBeInViewport();

    const corridors = page.getByRole("complementary", { name: "Corredores" });

    await expect(corridors).toBeInViewport();
    await expect(corridors.getByRole("listitem")).toHaveCount(3);
    await expect(corridors).toContainText("Javier Prado");
    await expect(corridors).toContainText("Avenida Arequipa");
    await expect(corridors).toContainText("Vía Expresa");
  });
}
