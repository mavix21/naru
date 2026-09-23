import { test, expect } from "@playwright/test";

import { fetchJavierPradoTraffic } from "../../app/src/services/tomtom-routing";
import { tomtomTrafficFixture } from "../fixtures/traffic";

test("loading resolves to normalized traffic and manual refresh changes ETA and timestamp", async ({
  page,
}) => {
  let requests = 0;
  let travelTime = 2520;
  let release: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/traffic/javier-prado", async (route) => {
    requests += 1;
    await gate;

    const fixture = tomtomTrafficFixture();

    fixture.routes[0].summary.travelTimeInSeconds = travelTime;

    const result = await fetchJavierPradoTraffic(
      "test-only-key",
      new AbortController().signal,
      async () => Response.json(fixture),
    );

    await route.fulfill({ json: result });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Javier Prado", exact: true }).click();

  const traffic = page.getByRole("region", { name: "Tráfico de Javier Prado" });

  await expect(traffic.getByRole("status")).toContainText(
    "Consultando tráfico",
  );
  release();
  await expect(traffic.getByRole("definition")).toHaveText("42 min");
  await expect(traffic).toContainText("+14 min más que en flujo libre");
  await expect(traffic).toContainText("28 min sin congestión");
  await expect(traffic).toContainText("7.1 km");

  const timestamp = await traffic.locator("time").getAttribute("datetime");
  const initialRequests = requests;

  travelTime = 2700;

  await traffic
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await expect(traffic.getByRole("definition")).toHaveText("45 min");
  await expect(traffic).toContainText("+17 min más que en flujo libre");
  await expect(traffic.locator("time")).not.toHaveAttribute(
    "datetime",
    timestamp ?? "",
  );
  expect(requests).toBe(initialRequests + 1);
});

test("polls only for the visible Javier Prado drawer and refreshes stale data on return", async ({
  page,
}) => {
  let requests = 0;
  let travelTime = 2520;

  await page.route("**/api/traffic/javier-prado", async (route) => {
    requests += 1;

    const fixture = tomtomTrafficFixture();

    fixture.routes[0].summary.travelTimeInSeconds = travelTime;

    const result = await fetchJavierPradoTraffic(
      "test-only-key",
      new AbortController().signal,
      async () => Response.json(fixture),
    );

    await route.fulfill({ json: result });
  });
  await page.clock.install();
  await page.goto("/");
  await page.clock.fastForward(240_000);
  expect(requests).toBe(0);

  const selector = page.getByRole("navigation", { name: "Corredores" });
  const traffic = page.getByRole("region", { name: "Tráfico de Javier Prado" });

  await selector
    .getByRole("button", { name: "Javier Prado", exact: true })
    .click();
  await expect(traffic.getByRole("definition")).toHaveText("42 min");

  const initialRequests = requests;

  const initialTimestamp = await traffic
    .locator("time")
    .getAttribute("datetime");

  await page.clock.fastForward(121_000);
  await expect.poll(() => requests).toBe(initialRequests + 1);
  await expect(traffic.locator("time")).not.toHaveAttribute(
    "datetime",
    initialTimestamp ?? "",
  );
  await expect(
    traffic.getByRole("button", { name: "Actualizar", exact: true }),
  ).toBeEnabled();

  // Exercise the browser visibility event used by the query lifecycle.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(360_000);
  expect(requests).toBe(initialRequests + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(initialRequests + 2);
  await expect(
    traffic.getByRole("button", { name: "Actualizar", exact: true }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Cerrar detalles" }).click();
  await page.clock.fastForward(360_000);
  expect(requests).toBe(initialRequests + 2);

  for (const name of ["Avenida Arequipa", "Vía Expresa"]) {
    await selector.getByRole("button", { name, exact: true }).press("Enter");
    await expect(traffic).not.toBeVisible();
    await page.clock.fastForward(240_000);
    expect(requests).toBe(initialRequests + 2);
  }

  travelTime = 2700;
  await selector
    .getByRole("button", { name: "Javier Prado", exact: true })
    .press("Enter");
  await expect(traffic.getByRole("definition")).toHaveText("45 min");
});

for (const status of ["not-configured", "provider-error", "unavailable"]) {
  test(`${status} shows an intentional state and can recover on refresh`, async ({
    page,
  }) => {
    let recover = false;

    await page.route("**/api/traffic/javier-prado", async (route) => {
      const result = recover
        ? await fetchJavierPradoTraffic(
            "test-only-key",
            new AbortController().signal,
            async () => Response.json(tomtomTrafficFixture()),
          )
        : { status };

      await route.fulfill({ status: recover ? 200 : 503, json: result });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Javier Prado", exact: true })
      .click();

    const traffic = page.getByRole("region", {
      name: "Tráfico de Javier Prado",
    });

    await expect(traffic.getByRole("alert")).toBeVisible();
    await expect(traffic.getByRole("definition")).toHaveCount(0);
    await expect(traffic.locator("time")).toHaveCount(0);
    recover = true;
    await traffic
      .getByRole("button", { name: "Actualizar", exact: true })
      .click();
    await expect(traffic.getByRole("alert")).toHaveCount(0);
    await expect(traffic.getByRole("definition")).toHaveText("42 min");
  });
}

test("a failed refresh removes the old current ETA instead of presenting it as live", async ({
  page,
}) => {
  let fail = false;

  await page.route("**/api/traffic/javier-prado", async (route) => {
    if (fail) return route.abort("failed");

    const result = await fetchJavierPradoTraffic(
      "test-only-key",
      new AbortController().signal,
      async () => Response.json(tomtomTrafficFixture()),
    );

    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Javier Prado", exact: true }).click();

  const traffic = page.getByRole("region", { name: "Tráfico de Javier Prado" });

  await expect(traffic.getByRole("definition")).toHaveText("42 min");
  fail = true;
  await traffic
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await expect(traffic.getByRole("alert")).toContainText("Revisa tu conexión");
  await expect(traffic.getByRole("definition")).toHaveCount(0);
  await expect(traffic.locator("time")).toHaveCount(0);
});

for (const width of [1440, 320]) {
  test(`traffic stays readable inside the ${width}px drawer layout`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });

    const tileLoaded = page.waitForResponse(
      (response) =>
        response.url().startsWith("https://tiles.openfreemap.org/planet/") &&
        response.url().endsWith(".pbf") &&
        response.ok(),
    );

    await page.route("**/api/traffic/javier-prado", async (route) => {
      const result = await fetchJavierPradoTraffic(
        "test-only-key",
        new AbortController().signal,
        async () => Response.json(tomtomTrafficFixture()),
      );

      await route.fulfill({ json: result });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Javier Prado", exact: true })
      .click();

    const traffic = page.getByRole("region", {
      name: "Tráfico de Javier Prado",
    });

    await tileLoaded;
    await expect
      .poll(
        async () =>
          (await page.locator('[data-slot="drawer-popup"]').boundingBox())?.x,
      )
      .toBeLessThanOrEqual(width - (width === 320 ? 160 : 320) + 1);
    await expect(traffic.getByRole("definition")).toHaveText("42 min");
    await expect(
      traffic.getByRole("button", { name: "Actualizar", exact: true }),
    ).toBeInViewport();
    expect(
      await traffic.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("traffic-drawer.png") });
  });
}
