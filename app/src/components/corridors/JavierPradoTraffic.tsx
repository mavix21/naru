"use client";

import { IconRefresh } from "@tabler/icons-react";

import type { TrafficSummary } from "@/domain/traffic";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useJavierPradoTraffic } from "@/hooks/useJavierPradoTraffic";

function duration(seconds: number) {
  if (seconds === 0) return "0 min";

  if (seconds < 60) return "menos de 1 min";

  return `${Math.round(seconds / 60)} min`;
}

function delayDescription(summary: TrafficSummary) {
  const delay = summary.delayVsFreeFlowSeconds ?? summary.trafficDelaySeconds;

  if (delay === 0) return "Sin demora por tráfico";

  if (delay < 0) return `${duration(-delay)} menos que en flujo libre`;

  const comparison =
    summary.delayVsFreeFlowSeconds === null
      ? "de demora por tráfico"
      : "más que en flujo libre";

  return `+${duration(delay)} ${comparison}`;
}

function TrafficEstimate({ summary }: { summary: TrafficSummary }) {
  const updatedTime = new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Lima",
  }).format(new Date(summary.retrievedAt));

  const distance = new Intl.NumberFormat("es-PE", {
    maximumFractionDigits: 1,
  }).format(summary.distanceMeters / 1000);

  return (
    <div className="space-y-3">
      <dl>
        <dt className="text-xs text-muted-foreground">Tiempo estimado ahora</dt>
        <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {duration(summary.travelTimeSeconds)}
        </dd>
      </dl>
      <div className="space-y-1">
        <p className="font-medium tabular-nums">{delayDescription(summary)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {summary.freeFlowTravelTimeSeconds === null
            ? "Tiempo sin congestión no disponible"
            : `${duration(summary.freeFlowTravelTimeSeconds)} sin congestión`}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{distance} km · En auto</p>
      <p className="text-xs text-muted-foreground">
        Actualizado a las{" "}
        <time dateTime={summary.retrievedAt} title="Hora de Lima">
          {updatedTime}
        </time>
      </p>
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
      "TomTom no devolvió una respuesta válida. Intenta actualizar de nuevo.",
  },
  unavailable: {
    title: "Tráfico no disponible por ahora",
    description:
      "No podemos obtener una estimación para este recorrido. Intenta de nuevo en unos minutos.",
  },
};

export default function JavierPradoTraffic() {
  const traffic = useJavierPradoTraffic();
  const result = traffic.data;

  const failure = traffic.isError
    ? {
        title: "No pudimos actualizar",
        description: "Revisa tu conexión e intenta de nuevo.",
      }
    : result && result.status !== "ready"
      ? failureMessages[result.status]
      : null;

  return (
    <section aria-label="Tráfico de Javier Prado" className="space-y-4 pb-4">
      <Separator />
      <h2 className="font-medium">Tráfico actual</h2>
      <div aria-live="polite" aria-busy={traffic.isFetching}>
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
          <TrafficEstimate summary={result.summary} />
        ) : null}
      </div>
      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          disabled={traffic.isFetching}
          onClick={() => void traffic.refetch()}
          className="w-full"
        >
          <IconRefresh aria-hidden="true" />
          {traffic.isFetching ? "Consultando…" : "Actualizar"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {result?.status === "not-configured"
            ? "TomTom · Routing API"
            : "TomTom · Se actualiza cada 2 min mientras lo ves."}
        </p>
      </div>
    </section>
  );
}
