"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

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

async function loadTraffic(signal: AbortSignal) {
  const response = await fetch("/api/traffic/javier-prado", {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });

  return trafficResultSchema.parse(await response.json());
}

// Mounted only while the Javier Prado drawer is open. Consuming the query
// signal also cancels an in-flight browser request when the drawer unmounts.
export function useJavierPradoTraffic() {
  const visible = useSyncExternalStore(
    subscribeToVisibility,
    isPageVisible,
    isServerVisible,
  );

  return useQuery({
    queryKey: ["traffic", "javier-prado"],
    queryFn: ({ signal }) => loadTraffic(signal),
    enabled: visible,
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
