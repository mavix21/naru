"use client";

import { useEffect, useState } from "react";

import type { TrafficObservation } from "@/domain/traffic";
import type { useCorridorTraffic } from "@/hooks/useCorridorTraffic";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function duration(seconds: number) {
  if (seconds === 0) return "0 min";

  if (seconds < 60) return "menos de 1 min";

  return `${Math.round(seconds / 60)} min`;
}

function delayDescription(summary: TrafficObservation) {
  const delay = summary.delayVsFreeFlowSeconds ?? summary.trafficDelaySeconds;

  if (delay <= 0) return "Sin demoras por tráfico";

  return `+${duration(delay)} por tráfico`;
}

function TrafficEstimate({ summary }: { summary: TrafficObservation }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const minutesAgo = Math.max(
    0,
    Math.floor((now - Date.parse(summary.retrievedAt)) / 60_000),
  );

  const freshness =
    minutesAgo === 0
      ? "Actualizado ahora"
      : `Actualizado hace ${minutesAgo} min`;

  const distance = new Intl.NumberFormat("es-PE", {
    maximumFractionDigits: 1,
  }).format(summary.distanceMeters / 1000);

  return (
    <div>
      <dl className="space-y-3">
        <div>
          <dt className="sr-only">Tiempo estimado ahora</dt>
          <dd className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
            {duration(summary.travelTimeSeconds)}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="sr-only">Impacto del tráfico</dt>
          <dd className="text-sm leading-snug font-medium tabular-nums">
            {delayDescription(summary)}
          </dd>
          <dt className="sr-only">Tiempo sin tráfico</dt>
          <dd className="text-xs leading-snug text-muted-foreground tabular-nums">
            Sin tráfico:{" "}
            {summary.freeFlowTravelTimeSeconds === null
              ? "no disponible"
              : duration(summary.freeFlowTravelTimeSeconds)}
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <p>{distance} km · En auto</p>
        <time
          dateTime={summary.retrievedAt}
          className="block text-[11px] leading-snug"
        >
          {freshness}
        </time>
      </div>
    </div>
  );
}

const failureMessages = {
  "not-configured": {
    title: "Tráfico sin configurar",
    description: "Falta configurar la clave de TomTom en el servidor.",
  },
  "provider-error": {
    title: "No pudimos consultar el tráfico",
    description:
      "No hay datos disponibles por ahora. Volveremos a intentarlo en unos minutos.",
  },
  unavailable: {
    title: "Tráfico no disponible por ahora",
    description:
      "No podemos obtener una estimación para este recorrido por ahora.",
  },
};

export default function CorridorTraffic({
  corridorName,
  traffic,
}: {
  corridorName: string;
  traffic: ReturnType<typeof useCorridorTraffic>;
}) {
  const result = traffic.data;

  const failure = traffic.isError
    ? {
        title: "No pudimos actualizar",
        description:
          "Revisa tu conexión. Volveremos a intentarlo en unos minutos.",
      }
    : result && result.status !== "ready"
      ? failureMessages[result.status]
      : null;

  return (
    <section aria-label={`Tráfico de ${corridorName}`} className="pb-4 pt-5">
      <h2 className="text-xs font-medium text-muted-foreground">
        Tiempo de viaje ahora
      </h2>
      <div className="mt-2" aria-live="polite" aria-busy={traffic.isFetching}>
        {traffic.isPending ? (
          <output className="text-sm text-muted-foreground">
            Consultando tráfico…
          </output>
        ) : failure ? (
          <Alert>
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription>{failure.description}</AlertDescription>
          </Alert>
        ) : result?.status === "ready" ? (
          <TrafficEstimate summary={result.observation} />
        ) : null}
      </div>
    </section>
  );
}
