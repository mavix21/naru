"use client";

import type { Map as MapLibreMap } from "maplibre-gl";

import { useEffect, useRef } from "react";

import { corridors } from "@/domain/corridors";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const LIMA_CENTER: [number, number] = [-77.0428, -12.0464];

export default function LimaMap() {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;

    async function initializeMap() {
      const { LngLatBounds, Map, NavigationControl } =
        await import("maplibre-gl");

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

      const bounds = new LngLatBounds();

      for (const corridor of corridors) {
        for (const route of corridor.routes) {
          for (const [longitude, latitude] of route.points) {
            bounds.extend([longitude, latitude]);
          }
        }
      }

      map.fitBounds(bounds, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        maxZoom: 12.5,
        duration: 0,
      });

      map.on("load", () => {
        if (!map) return;

        map.addSource("corridor-routes", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: corridors.flatMap((corridor) =>
              corridor.routes.map((route) => ({
                type: "Feature",
                properties: { id: route.id, name: corridor.name },
                geometry: {
                  type: "LineString",
                  coordinates: route.points.map(([longitude, latitude]) => [
                    longitude,
                    latitude,
                  ]),
                },
              })),
            ),
          },
        });

        map.addLayer({
          id: "corridor-routes-casing",
          type: "line",
          source: "corridor-routes",
          paint: {
            "line-color": "#ffffff",
            "line-width": 8,
            "line-opacity": 0.9,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        map.addLayer({
          id: "corridor-routes-line",
          type: "line",
          source: "corridor-routes",
          paint: { "line-color": "#4f46e5", "line-width": 4 },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        map.addLayer({
          id: "corridor-routes-label",
          type: "symbol",
          source: "corridor-routes",
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 13,
          },
          paint: {
            "text-color": "#312e81",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
      });
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
