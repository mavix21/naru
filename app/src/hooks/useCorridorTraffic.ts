"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import type { Corridor } from "@/domain/corridors";

import { trafficResultSchema } from "@/domain/traffic";

const REFRESH_INTERVAL_MS = 120_000;

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);

  return () => document.removeEventListener("visibilitychange", onChange);
}

function isPageVisible() {
  return document.visibilityState === "visible";
}

function isServerVisible() {
  return false;
}

async function loadTraffic(
  corridorId: string,
  routeId: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/traffic/${encodeURIComponent(corridorId)}`,
    {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );

  const result = trafficResultSchema.parse(await response.json());

  if (
    result.status === "ready" &&
    (!response.ok || result.observation.routeId !== routeId)
  ) {
    throw new Error("Traffic response does not match the requested route");
  }

  return result;
}

// One route-keyed observation feeds both the map and the drawer. Cached routes
// remain usable when closed, but only the visible, open drawer requests traffic.
export function useCorridorTraffic(corridor: Corridor, detailsOpen: boolean) {
  const queryClient = useQueryClient();

  const visible = useSyncExternalStore(
    subscribeToVisibility,
    isPageVisible,
    isServerVisible,
  );

  const enabled = visible && detailsOpen;
  const corridorId = corridor.id;
  const routeId = corridor.routes[0].id;

  useEffect(() => {
    if (!enabled) {
      void queryClient.cancelQueries({
        queryKey: ["traffic", corridorId, routeId],
        exact: true,
      });
    }
  }, [enabled, corridorId, routeId, queryClient]);

  return useQuery({
    queryKey: ["traffic", corridorId, routeId],
    queryFn: ({ signal }) => loadTraffic(corridorId, routeId, signal),
    enabled,
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: (query) =>
      query.state.data?.status === "not-configured"
        ? false
        : REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
