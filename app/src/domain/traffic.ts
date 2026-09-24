import { z } from "zod";

const seconds = z.number().nonnegative();

export const trafficObservationSchema = z.object({
  routeId: z.string().min(1),
  // The exact measured route, in domain/map [longitude, latitude] order.
  points: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .min(2),
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

export type TrafficObservation = z.infer<typeof trafficObservationSchema>;

export const trafficResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    observation: trafficObservationSchema,
  }),
  z.object({ status: z.literal("not-configured") }),
  z.object({ status: z.literal("provider-error") }),
  z.object({ status: z.literal("unavailable") }),
]);

export type TrafficResult = z.infer<typeof trafficResultSchema>;
