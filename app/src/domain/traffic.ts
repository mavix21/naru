import { z } from "zod";

export const JAVIER_PRADO_ROUTE_ID = "javier-prado-arequipa-monitor-eastbound";

const seconds = z.number().nonnegative();

export const trafficSummarySchema = z.object({
  routeId: z.literal(JAVIER_PRADO_ROUTE_ID),
  travelTimeSeconds: seconds.positive(),
  freeFlowTravelTimeSeconds: seconds.nullable(),
  // Best-estimate ETA minus the free-flow ETA for this same route.
  delayVsFreeFlowSeconds: z.number().nullable(),
  // Provider-reported live delay; not necessarily ETA minus free-flow time.
  trafficDelaySeconds: seconds,
  typicalTravelTimeSeconds: seconds.nullable(),
  liveTravelTimeSeconds: seconds.nullable(),
  distanceMeters: z.number().positive(),
  retrievedAt: z.iso.datetime(),
});

export type TrafficSummary = z.infer<typeof trafficSummarySchema>;

export const trafficResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), summary: trafficSummarySchema }),
  z.object({ status: z.literal("not-configured") }),
  z.object({ status: z.literal("provider-error") }),
  z.object({ status: z.literal("unavailable") }),
]);

export type TrafficResult = z.infer<typeof trafficResultSchema>;
