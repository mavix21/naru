"use client";

import type { Map as MapLibreMap } from "maplibre-gl";

import { useEffect, useRef } from "react";

import type { Corridor } from "@/domain/corridors";

import { corridors } from "@/domain/corridors";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const LIMA_CENTER: [number, number] = [-77.0428, -12.0464];

const ROUTE_LAYERS = [
  "corridor-routes-casing",
  "corridor-routes-line",
  "corridor-routes-label",
];

function corridorBounds(
  corridor: Corridor,
): [[number, number], [number, number]] {
  const [longitude, latitude] = corridor.routes[0].points[0];

  const bounds: [[number, number], [number, number]] = [
    [longitude, latitude],
    [longitude, latitude],
  ];

  for (const route of corridor.routes) {
    for (const [routeLongitude, routeLatitude] of route.points) {
      bounds[0][0] = Math.min(bounds[0][0], routeLongitude);
      bounds[0][1] = Math.min(bounds[0][1], routeLatitude);
      bounds[1][0] = Math.max(bounds[1][0], routeLongitude);
      bounds[1][1] = Math.max(bounds[1][1], routeLatitude);
    }
  }

  return bounds;
}

function focusCorridor(
  map: MapLibreMap,
  selectedCorridorId: string,
  detailsOpen: boolean,
  duration: number,
) {
  const corridor =
    corridors.find((item) => item.id === selectedCorridorId) ?? corridors[0];

  for (const layerId of ROUTE_LAYERS) {
    map.setFilter(layerId, ["==", ["get", "corridorId"], corridor.id]);
  }

  const width = map.getContainer().clientWidth;
  const drawerWidth = width < 640 ? width / 2 : 320;

  const controls = map
    .getContainer()
    .querySelector<HTMLElement>(".maplibregl-ctrl-top-right");

  if (controls) controls.style.right = detailsOpen ? `${drawerWidth}px` : "";

  map.fitBounds(corridorBounds(corridor), {
    padding: {
      top: 56,
      right: detailsOpen ? drawerWidth + 24 : 48,
      bottom: 56,
      left: 48,
    },
    maxZoom: 13.5,
    duration,
  });
}

export default function LimaMap({
  selectedCorridorId,
  detailsOpen,
}: {
  selectedCorridorId: string;
  detailsOpen: boolean;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectionRef = useRef({ selectedCorridorId, detailsOpen });

  useEffect(() => {
    let disposed = false;

    async function initializeMap() {
      const { Map, NavigationControl } = await import("maplibre-gl");

      if (disposed || !containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: LIMA_CENTER,
        zoom: 10.8,
      });

      mapRef.current = map;

      map.addControl(
        new NavigationControl({ showCompass: false }),
        "top-right",
      );

      map.on("load", () => {
        if (disposed) return;

        map.addSource("corridor-routes", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: corridors.flatMap((corridor) =>
              corridor.routes.map((route) => ({
                type: "Feature",
                properties: {
                  id: route.id,
                  corridorId: corridor.id,
                  name: corridor.name,
                },
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

        const { selectedCorridorId, detailsOpen } = selectionRef.current;

        focusCorridor(map, selectedCorridorId, detailsOpen, 0);
      });
    }

    function handleResize() {
      if (!mapRef.current?.getLayer("corridor-routes-line")) return;

      const { selectedCorridorId, detailsOpen } = selectionRef.current;

      focusCorridor(mapRef.current, selectedCorridorId, detailsOpen, 0);
    }

    void initializeMap();
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    selectionRef.current = { selectedCorridorId, detailsOpen };

    if (!mapRef.current?.getLayer("corridor-routes-line")) return;

    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 650;

    focusCorridor(mapRef.current, selectedCorridorId, detailsOpen, duration);
  }, [selectedCorridorId, detailsOpen]);

  return (
    <section
      ref={containerRef}
      className="h-full w-full"
      aria-label="Mapa interactivo de Lima, Perú"
    />
  );
}
