"use client";

import type { Map as MapLibreMap } from "maplibre-gl";

import { useEffect, useRef } from "react";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const LIMA_CENTER: [number, number] = [-77.0428, -12.0464];

export default function LimaMap() {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;

    async function initializeMap() {
      const { Map, NavigationControl } = await import("maplibre-gl");

      if (disposed || !containerRef.current) return;

      map = new Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: LIMA_CENTER,
        zoom: 10.8,
      });

      map.addControl(
        new NavigationControl({ showCompass: false }),
        "top-right",
      );
    }

    void initializeMap();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, []);

  return (
    <section
      ref={containerRef}
      className="h-full w-full"
      aria-label="Mapa interactivo de Lima, Perú"
    />
  );
}
