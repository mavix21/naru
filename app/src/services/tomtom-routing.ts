import { z } from "zod";

import { corridors, type GeographicPoint } from "../domain/corridors";
import { JAVIER_PRADO_ROUTE_ID, type TrafficResult } from "../domain/traffic";

const tomtomPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const tomtomRouteSchema = z.object({
  summary: z.object({
    lengthInMeters: z.number().positive(),
    travelTimeInSeconds: z.number().positive(),
    trafficDelayInSeconds: z.number().nonnegative(),
    noTrafficTravelTimeInSeconds: z.number().nonnegative().optional(),
    historicTrafficTravelTimeInSeconds: z.number().nonnegative().optional(),
    liveTrafficIncidentsTravelTimeInSeconds: z
      .number()
      .nonnegative()
      .optional(),
  }),
  legs: z.array(z.object({ points: z.array(tomtomPointSchema).min(2) })),
  sections: z
    .array(
      z.object({
        sectionType: z.string(),
        simpleCategory: z.string().optional(),
      }),
    )
    .optional(),
});

const tomtomResponseSchema = z.object({ routes: z.array(tomtomRouteSchema) });

const tomtomErrorSchema = z.object({
  detailedError: z.object({ code: z.string() }),
});

type TomtomRoute = z.infer<typeof tomtomRouteSchema>;

type TomtomPoint = z.infer<typeof tomtomPointSchema>;

// The curated trace and TomTom's road centerlines need not coincide exactly.
// Allow 150 m for road curvature/map matching, but reject off-corridor detours.
const CORRIDOR_TOLERANCE_METERS = 150;

const METERS_PER_DEGREE = 111_320;

function projectToSegment(
  point: TomtomPoint,
  start: GeographicPoint,
  end: GeographicPoint,
) {
  const longitudeScale = Math.cos((start[1] * Math.PI) / 180);
  const x = (point.longitude - start[0]) * longitudeScale;
  const y = point.latitude - start[1];
  const dx = (end[0] - start[0]) * longitudeScale;
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;

  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));

  const lengthMeters = Math.sqrt(lengthSquared) * METERS_PER_DEGREE;

  return {
    distanceMeters:
      Math.hypot(x - fraction * dx, y - fraction * dy) * METERS_PER_DEGREE,
    progressMeters: fraction * lengthMeters,
    lengthMeters,
  };
}

function locateOnTrace(point: TomtomPoint, trace: readonly GeographicPoint[]) {
  let nearest = { distanceMeters: Infinity, progressMeters: 0 };
  let offsetMeters = 0;

  for (let index = 0; index < trace.length - 1; index += 1) {
    const projection = projectToSegment(point, trace[index], trace[index + 1]);

    if (projection.distanceMeters < nearest.distanceMeters) {
      nearest = {
        distanceMeters: projection.distanceMeters,
        progressMeters: offsetMeters + projection.progressMeters,
      };
    }

    offsetMeters += projection.lengthMeters;
  }

  return nearest;
}

function followsCorridor(
  route: TomtomRoute,
  points: readonly GeographicPoint[],
) {
  // A reconstructed trace has one continuous leg, not a stop at each vertex.
  if (route.legs.length !== 1) return false;

  const actual = route.legs[0].points;
  const start = points[0];
  const end = points[points.length - 1];

  if (
    projectToSegment(actual[0], start, start).distanceMeters >
      CORRIDOR_TOLERANCE_METERS ||
    projectToSegment(actual[actual.length - 1], end, end).distanceMeters >
      CORRIDOR_TOLERANCE_METERS
  )
    return false;

  let furthestProgress = 0;

  for (const point of actual) {
    const location = locateOnTrace(point, points);

    if (
      location.distanceMeters > CORRIDOR_TOLERANCE_METERS ||
      location.progressMeters < furthestProgress - CORRIDOR_TOLERANCE_METERS
    )
      return false;

    furthestProgress = Math.max(furthestProgress, location.progressMeters);
  }

  const actualTrace = actual.map((point): GeographicPoint => [
    point.longitude,
    point.latitude,
  ]);

  // Check coverage in both directions, so a shortcut cannot skip a trace bend.
  return points.every(
    ([longitude, latitude]) =>
      locateOnTrace({ longitude, latitude }, actualTrace).distanceMeters <=
      CORRIDOR_TOLERANCE_METERS,
  );
}

// Only the server route supplies credentials. Injecting fetch keeps the real
// HTTP boundary testable without replacing modules or contacting paid products.
export async function fetchJavierPradoTraffic(
  apiKey: string | undefined,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrafficResult> {
  if (!apiKey?.trim()) return { status: "not-configured" };

  const corridor = corridors.find((item) => item.id === "javier-prado");

  const route = corridor?.routes.find(
    (item) => item.id === JAVIER_PRADO_ROUTE_ID,
  );

  if (!route || route.points.length < 2) return { status: "unavailable" };

  // MapLibre uses [longitude, latitude]; TomTom requires latitude,longitude.
  // These are map-trace vertices, not stopover checkpoints. Making each one a
  // mandatory stop can snap it to an opposing carriageway and introduce loops.
  // Track reconstruction follows the same exact trace in its driving direction.
  const locations = [route.points[0], route.points[route.points.length - 1]]
    .map(([lng, lat]) => `${lat},${lng}`)
    .join(":");

  const url = new URL(
    `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`,
  );

  url.search = new URLSearchParams({
    key: apiKey.trim(),
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
  }).toString();

  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);

  try {
    const response = await fetcher(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        supportingPoints: route.points.map(([longitude, latitude]) => ({
          latitude,
          longitude,
        })),
      }),
      signal: requestSignal,
    });

    if (response.status === 429 || response.status >= 500) {
      return { status: "unavailable" };
    }

    const body: unknown = await response.json();

    if (!response.ok) {
      const error = tomtomErrorSchema.safeParse(body);

      if (
        error.success &&
        [
          "NO_ROUTE_FOUND",
          "MAP_MATCHING_FAILURE",
          "COMPUTE_TIME_LIMIT_EXCEEDED",
          "CANNOT_RESTORE_BASEROUTE",
        ].includes(error.data.detailedError.code)
      ) {
        return { status: "unavailable" };
      }

      return { status: "provider-error" };
    }

    const parsed = tomtomResponseSchema.safeParse(body);

    if (!parsed.success) return { status: "provider-error" };

    const result = parsed.data.routes[0];

    if (!result || !followsCorridor(result, route.points)) {
      return { status: "unavailable" };
    }

    // TomTom can reconstruct a reference route through a closure while ignoring
    // that closure in its ETA. Such a route is not a current traversable trip.
    if (
      result.sections?.some(
        (section) =>
          section.sectionType === "TRAFFIC" &&
          section.simpleCategory === "ROAD_CLOSURE",
      )
    )
      return { status: "unavailable" };

    const summary = result.summary;
    const freeFlow = summary.noTrafficTravelTimeInSeconds ?? null;

    return {
      status: "ready",
      summary: {
        routeId: JAVIER_PRADO_ROUTE_ID,
        travelTimeSeconds: summary.travelTimeInSeconds,
        freeFlowTravelTimeSeconds: freeFlow,
        delayVsFreeFlowSeconds:
          freeFlow === null ? null : summary.travelTimeInSeconds - freeFlow,
        trafficDelaySeconds: summary.trafficDelayInSeconds,
        typicalTravelTimeSeconds:
          summary.historicTrafficTravelTimeInSeconds ?? null,
        liveTravelTimeSeconds:
          summary.liveTrafficIncidentsTravelTimeInSeconds ?? null,
        distanceMeters: summary.lengthInMeters,
        retrievedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    // Never return/log provider URLs or error bodies: they can contain the key.
    return {
      status: error instanceof SyntaxError ? "provider-error" : "unavailable",
    };
  }
}
