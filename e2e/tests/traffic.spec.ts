import { test, expect } from "@playwright/test";

import { corridors } from "../../app/src/domain/corridors";
import { trafficFixture } from "../fixtures/traffic";

for (const [index, corridor] of corridors.entries()) {
  test(`${corridor.name}: loading resolves to its traffic and refresh changes ETA and timestamp`, async ({
    page,
  }) => {
    let requests = 0;
    let travelTime = 2520 + index * 600;
    let release: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route(`**/api/traffic/${corridor.id}`, async (route) => {
      requests += 1;
      await gate;
      await route.fulfill({ json: await trafficFixture(corridor, travelTime) });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: corridor.name, exact: true })
      .press("Enter");

    const traffic = page.getByRole("region", {
      name: `Tráfico de ${corridor.name}`,
    });

    await expect(traffic.getByRole("status")).toContainText(
      "Consultando tráfico",
    );
    release();
    await expect(traffic.getByRole("definition")).toHaveText(
      `${42 + index * 10} min`,
    );
    await expect(traffic).toContainText(
      `+${14 + index * 10} min más que en flujo libre`,
    );
    await expect(traffic).toContainText("28 min sin congestión");
    await expect(traffic).toContainText("7.1 km");

    const timestamp = await traffic.locator("time").getAttribute("datetime");

    travelTime += 180;
    await traffic
      .getByRole("button", { name: "Actualizar", exact: true })
      .click();
    await expect(traffic.getByRole("definition")).toHaveText(
      `${45 + index * 10} min`,
    );
    await expect(traffic.locator("time")).not.toHaveAttribute(
      "datetime",
      timestamp ?? "",
    );
    expect(requests).toBe(2);
  });

  test(`${corridor.name}: polls only while open and visible, reuses fresh data, refreshes stale data`, async ({
    page,
  }) => {
    let requests = 0;
    let travelTime = 2520;

    await page.route(`**/api/traffic/${corridor.id}`, async (route) => {
      requests += 1;
      await route.fulfill({ json: await trafficFixture(corridor, travelTime) });
    });
    await page.clock.install();
    await page.goto("/");
    await page.clock.fastForward(240_000);
    expect(requests).toBe(0);

    const select = page
      .getByRole("navigation", { name: "Corredores" })
      .getByRole("button", { name: corridor.name, exact: true });

    const traffic = page.getByRole("region", {
      name: `Tráfico de ${corridor.name}`,
    });

    await select.press("Enter");
    await expect(traffic.getByRole("definition")).toHaveText("42 min");
    await select.press("Enter");
    await page.getByRole("button", { name: "Cerrar detalles" }).click();
    await select.press("Enter");
    await expect(traffic.getByRole("definition")).toHaveText("42 min");
    expect(requests).toBe(1);

    travelTime = 2700;
    await page.clock.fastForward(121_000);
    await expect(traffic.getByRole("definition")).toHaveText("45 min");
    expect(requests).toBe(2);

    // Exercise the browser visibility event used by the query lifecycle.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(360_000);
    expect(requests).toBe(2);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => requests).toBe(3);
    await expect(
      traffic.getByRole("button", { name: "Actualizar", exact: true }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Cerrar detalles" }).click();
    await page.clock.fastForward(360_000);
    expect(requests).toBe(3);
    travelTime = 2880;
    await select.press("Enter");
    await expect(traffic.getByRole("definition")).toHaveText("48 min");
    expect(requests).toBe(4);
  });

  for (const status of ["not-configured", "provider-error", "unavailable"]) {
    test(`${corridor.name}: ${status} shows an intentional state and recovers on refresh`, async ({
      page,
    }) => {
      let recover = false;

      await page.route(`**/api/traffic/${corridor.id}`, async (route) => {
        await route.fulfill({
          status: recover ? 200 : 503,
          json: recover ? await trafficFixture(corridor) : { status },
        });
      });
      await page.goto("/");
      await page
        .getByRole("button", { name: corridor.name, exact: true })
        .press("Enter");

      const traffic = page.getByRole("region", {
        name: `Tráfico de ${corridor.name}`,
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
}

test("rapid switching cancels obsolete requests and isolates each route's observation and cache", async ({
  page,
}) => {
  const requests = new Map<string, number>();
  let release: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/traffic/*", async (route) => {
    const corridor = corridors.find((item) =>
      route.request().url().endsWith(`/${item.id}`),
    );

    if (!corridor) throw new Error("Unexpected traffic request");

    requests.set(corridor.id, (requests.get(corridor.id) ?? 0) + 1);

    if (corridor.id === "avenida-arequipa") await gate;

    await route.fulfill({
      json: await trafficFixture(
        corridor,
        corridor.id === "via-expresa" ? 600 : 2520,
      ),
    });
  });
  await page.goto("/");

  const selector = page.getByRole("navigation", { name: "Corredores" });

  await selector
    .getByRole("button", { name: "Javier Prado", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Tráfico de Javier Prado" })
      .getByRole("definition"),
  ).toHaveText("42 min");
  await selector
    .getByRole("button", { name: "Avenida Arequipa", exact: true })
    .click();

  const arequipa = page.getByRole("region", {
    name: "Tráfico de Avenida Arequipa",
  });

  await expect(arequipa.getByRole("status")).toContainText(
    "Consultando tráfico",
  );
  await expect(arequipa.getByRole("definition")).toHaveCount(0);
  await expect(arequipa.locator("time")).toHaveCount(0);
  await expect.poll(() => requests.get("avenida-arequipa")).toBe(1);

  const cancelled = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/traffic/avenida-arequipa"),
  );

  await selector
    .getByRole("button", { name: "Vía Expresa", exact: true })
    .press("Enter");
  await cancelled;

  const expresa = page.getByRole("region", { name: "Tráfico de Vía Expresa" });

  await expect(expresa.getByRole("definition")).toHaveText("10 min");
  release();
  await expect(expresa.getByRole("definition")).toHaveText("10 min");
  await selector
    .getByRole("button", { name: "Javier Prado", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Tráfico de Javier Prado" })
      .getByRole("definition"),
  ).toHaveText("42 min");
  expect(requests.get("javier-prado")).toBe(1);
  await selector
    .getByRole("button", { name: "Avenida Arequipa", exact: true })
    .click();
  await expect(arequipa.getByRole("definition")).toHaveText("42 min");
  expect(requests.get("avenida-arequipa")).toBe(2);
  expect(requests.get("via-expresa")).toBe(1);
});

test("closing a loading drawer cancels the in-flight request", async ({
  page,
}) => {
  let release: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/traffic/via-expresa", async (route) => {
    await gate;
    await route.fulfill({ json: await trafficFixture(corridors[2]) });
  });
  await page.goto("/");

  const requested = page.waitForRequest("**/api/traffic/via-expresa");

  await page
    .getByRole("button", { name: "Vía Expresa", exact: true })
    .press("Enter");
  await requested;

  const cancelled = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/traffic/via-expresa"),
  );

  await page.getByRole("button", { name: "Cerrar detalles" }).click();
  await cancelled;
  release();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("a response for the wrong route cannot populate the selected corridor", async ({
  page,
}) => {
  await page.route("**/api/traffic/avenida-arequipa", async (route) => {
    await route.fulfill({ json: await trafficFixture(corridors[0]) });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Avenida Arequipa", exact: true })
    .click();

  const traffic = page.getByRole("region", {
    name: "Tráfico de Avenida Arequipa",
  });

  await expect(traffic.getByRole("alert")).toBeVisible();
  await expect(traffic.getByRole("definition")).toHaveCount(0);
  await expect(traffic.locator("time")).toHaveCount(0);
});

test("a failed refresh removes the old current ETA instead of presenting it as live", async ({
  page,
}) => {
  let fail = false;

  await page.route("**/api/traffic/javier-prado", async (route) => {
    if (fail) return route.abort("failed");

    await route.fulfill({ json: await trafficFixture() });
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

    await page.route("**/api/traffic/*", async (route) => {
      const corridor = corridors.find((item) =>
        route.request().url().endsWith(`/${item.id}`),
      );

      if (!corridor) throw new Error("Unexpected traffic request");

      await route.fulfill({ json: await trafficFixture(corridor) });
    });
    await page.goto("/");
    await tileLoaded;

    for (const corridor of corridors) {
      await page
        .getByRole("button", { name: corridor.name, exact: true })
        .press("Enter");

      const traffic = page.getByRole("region", {
        name: `Tráfico de ${corridor.name}`,
      });

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
      await page.screenshot({
        path: testInfo.outputPath(`${corridor.id}-traffic-drawer.png`),
      });
    }
  });
}
