"use client";

import { IconX } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { corridors } from "@/domain/corridors";

import LimaMap from "../map/LimaMap";

export default function CorridorExplorer() {
  const [selectedCorridorId, setSelectedCorridorId] = useState(corridors[0].id);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedCorridor =
    corridors.find((corridor) => corridor.id === selectedCorridorId) ??
    corridors[0];

  const selectedRoute = selectedCorridor.routes[0];

  return (
    <section className="relative h-dvh min-h-80 overflow-hidden bg-muted">
      <LimaMap
        selectedCorridorId={selectedCorridorId}
        detailsOpen={detailsOpen}
      />
      <header className="pointer-events-none absolute top-4 left-4 z-10 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:top-6 sm:left-6">
        <h1 className="text-xl font-semibold tracking-tight">Pulso</h1>
        <p className="text-xs text-muted-foreground">Lima, Perú</p>
      </header>
      <nav
        aria-label="Corredores"
        className="absolute bottom-4 left-4 z-10 w-36 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur-sm sm:bottom-6 sm:left-6 sm:w-48"
      >
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          Corredores
        </p>
        <ul className="space-y-1">
          {corridors.map((corridor) => (
            <li key={corridor.id}>
              <Button
                type="button"
                size="sm"
                variant={
                  corridor.id === selectedCorridorId ? "default" : "ghost"
                }
                aria-pressed={corridor.id === selectedCorridorId}
                className="w-full justify-start"
                onClick={() => {
                  setSelectedCorridorId(corridor.id);
                  setDetailsOpen(true);
                }}
              >
                {corridor.name}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <Drawer
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        swipeDirection="right"
        modal={false}
        disablePointerDismissal
      >
        <DrawerContent className="w-1/2 sm:w-80">
          <DrawerHeader className="flex-row items-start justify-between">
            <div className="min-w-0">
              <DrawerTitle>{selectedCorridor.name}</DrawerTitle>
              <DrawerDescription>{selectedRoute.direction}</DrawerDescription>
            </div>
            <DrawerClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cerrar detalles"
                />
              }
            >
              <IconX />
            </DrawerClose>
          </DrawerHeader>
          <dl className="grid gap-5 px-4 py-6">
            <div>
              <dt className="text-xs text-muted-foreground">Origen</dt>
              <dd className="mt-1 font-medium">{selectedRoute.origin}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Destino</dt>
              <dd className="mt-1 font-medium">{selectedRoute.destination}</dd>
            </div>
          </dl>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
