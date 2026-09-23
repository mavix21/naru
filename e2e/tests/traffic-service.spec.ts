import { test, expect } from "@playwright/test";

import { corridors } from "../../app/src/domain/corridors";
import { fetchJavierPradoTraffic } from "../../app/src/services/tomtom-routing";
import { tomtomTrafficFixture } from "../fixtures/traffic";

test("reconstructs every existing Javier Prado trace point without turning vertices into stopovers", async () => {
  const requests: Request[] = [];
  const started = Date.now();

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json(tomtomTrafficFixture());
    },
  );

  expect(requests).toHaveLength(1);

  const url = new URL(requests[0].url);
  const corridor = corridors.find((item) => item.id === "javier-prado");

  if (!corridor) throw new Error("Missing Javier Prado corridor");

  const points = corridor.routes[0].points;

  expect(url.origin).toBe("https://api.tomtom.com");
  expect(decodeURIComponent(url.pathname)).toBe(
    `/routing/1/calculateRoute/${[points[0], points[points.length - 1]].map(([lng, lat]) => `${lat},${lng}`).join(":")}/json`,
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    key: "test-only-key",
    traffic: "true",
    departAt: "now",
    travelMode: "car",
    routeType: "fastest",
    computeBestOrder: "false",
    maxAlternatives: "0",
    computeTravelTimeFor: "all",
    routeRepresentation: "polyline",
    reconstructionMode: "track",
    sectionType: "traffic",
  });
  expect(requests[0].method).toBe("POST");
  expect(requests[0].headers.get("Content-Type")).toBe("application/json");
  expect(await requests[0].json()).toEqual({
    supportingPoints: points.map(([longitude, latitude]) => ({
      latitude,
      longitude,
    })),
  });
  expect(requests[0].cache).toBe("no-store");

  if (result.status !== "ready") throw new Error("Expected normalized traffic");

  expect(result.summary).toMatchObject({
    travelTimeSeconds: 2520,
    freeFlowTravelTimeSeconds: 1680,
    delayVsFreeFlowSeconds: 840,
    trafficDelaySeconds: 720,
    typicalTravelTimeSeconds: 2160,
    liveTravelTimeSeconds: 2460,
    distanceMeters: 7100,
  });
  expect(Date.parse(result.summary.retrievedAt)).toBeGreaterThanOrEqual(
    started,
  );
  expect(Date.parse(result.summary.retrievedAt)).toBeLessThanOrEqual(
    Date.now(),
  );
  expect(JSON.stringify(result)).not.toContain("test-only-key");
  expect(result.summary).not.toHaveProperty("legs");
});

test("missing configuration never contacts the provider", async () => {
  let requests = 0;

  const result = await fetchJavierPradoTraffic(
    "  ",
    new AbortController().signal,
    async () => {
      requests += 1;

      return Response.json(tomtomTrafficFixture());
    },
  );

  expect(result).toEqual({ status: "not-configured" });
  expect(requests).toBe(0);
});

test("missing optional traffic times stay missing rather than being invented", async () => {
  const fixture = tomtomTrafficFixture();
  const summary = fixture.routes[0].summary;

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () =>
      Response.json({
        routes: [
          {
            ...fixture.routes[0],
            summary: {
              lengthInMeters: summary.lengthInMeters,
              travelTimeInSeconds: summary.travelTimeInSeconds,
              trafficDelayInSeconds: 0,
            },
          },
        ],
      }),
  );

  expect(result).toMatchObject({
    status: "ready",
    summary: {
      freeFlowTravelTimeSeconds: null,
      delayVsFreeFlowSeconds: null,
      typicalTravelTimeSeconds: null,
      liveTravelTimeSeconds: null,
      trafficDelaySeconds: 0,
    },
  });
});

test("rejects detours even when the provider returns a successful ETA", async () => {
  const fixture = tomtomTrafficFixture();

  fixture.routes[0].legs[0].points.splice(4, 0, {
    latitude: -12.05,
    longitude: -77.01,
  });

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("allows small map-centerline differences along the same corridor", async () => {
  const fixture = tomtomTrafficFixture();

  for (const leg of fixture.routes[0].legs) {
    leg.points = leg.points.map((point) => ({
      ...point,
      latitude: point.latitude + 0.0003,
    }));
  }

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );

  expect(result.status).toBe("ready");
});

test("rejects backtracking even if the loop stays within the corridor", async () => {
  const fixture = tomtomTrafficFixture();

  const points = fixture.routes[0].legs[0].points;

  points.splice(8, 0, ...points.slice(4, 8));

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("rejects a route whose endpoints do not match the corridor", async () => {
  const fixture = tomtomTrafficFixture();

  fixture.routes[0].legs[0].points.reverse();

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("rejects a reconstructed route that is blocked by a road closure", async () => {
  const fixture = tomtomTrafficFixture();

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () =>
      Response.json({
        routes: [
          {
            ...fixture.routes[0],
            sections: [
              { sectionType: "TRAFFIC", simpleCategory: "ROAD_CLOSURE" },
            ],
          },
        ],
      }),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("traffic jams remain valid estimates on a reconstructed route", async () => {
  const fixture = tomtomTrafficFixture();

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () =>
      Response.json({
        routes: [
          {
            ...fixture.routes[0],
            sections: [{ sectionType: "TRAFFIC", simpleCategory: "JAM" }],
          },
        ],
      }),
  );

  expect(result.status).toBe("ready");
});

test("invalid required values cannot become an ETA", async () => {
  const fixture = tomtomTrafficFixture();

  fixture.routes[0].summary.travelTimeInSeconds = -1;

  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );

  expect(result).toEqual({ status: "provider-error" });
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`provider HTTP ${status} is an intentional failure without traffic values`, async () => {
    const result = await fetchJavierPradoTraffic(
      "test-only-key",
      new AbortController().signal,
      async () =>
        Response.json(
          { message: "Sensitive provider detail: test-only-key" },
          { status },
        ),
    );

    expect(result).toEqual({
      status:
        status === 401 || status === 403 ? "provider-error" : "unavailable",
    });
  });
}

test("a provider no-route response becomes unavailable", async () => {
  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () =>
      Response.json(
        { detailedError: { code: "NO_ROUTE_FOUND" } },
        { status: 400 },
      ),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("an empty route response becomes unavailable", async () => {
  const result = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => Response.json({ routes: [] }),
  );

  expect(result).toEqual({ status: "unavailable" });
});

test("invalid JSON and network errors never escape as provider details", async () => {
  const invalidJson = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => new Response("upstream HTML error"),
  );

  expect(invalidJson).toEqual({ status: "provider-error" });

  const networkError = await fetchJavierPradoTraffic(
    "test-only-key",
    new AbortController().signal,
    async () => {
      throw new Error("Failed URL with test-only-key");
    },
  );

  expect(networkError).toEqual({ status: "unavailable" });
});

test("cancelling the caller cancels the upstream request", async () => {
  const controller = new AbortController();

  const pending = fetchJavierPradoTraffic(
    "test-only-key",
    controller.signal,
    async (input, init) => {
      const request = new Request(input, init);

      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      request.signal.throwIfAborted();

      return Response.json(tomtomTrafficFixture());
    },
  );

  controller.abort();

  expect(await pending).toEqual({ status: "unavailable" });
});
