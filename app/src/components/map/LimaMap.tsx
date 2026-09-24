"use client";

import type {
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";

import { useEffect, useRef } from "react";

import type { Corridor, GeographicPoint } from "@/domain/corridors";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const LIMA_CENTER: [number, number] = [-77.0428, -12.0464];

function corridorFeature(
  corridor: Corridor,
  points: readonly GeographicPoint[],
): GeoJSONSourceSpecification["data"] {
  return {
    type: "Feature",
    properties: {
      id: corridor.routes[0].id,
      corridorId: corridor.id,
      name: corridor.name,
    },
    geometry: {
      type: "LineString",
      coordinates: points.map(([longitude, latitude]) => [longitude, latitude]),
    },
  };
}

function corridorBounds(
  points: readonly GeographicPoint[],
): [[number, number], [number, number]] {
  const [longitude, latitude] = points[0];

  const bounds: [[number, number], [number, number]] = [
    [longitude, latitude],
    [longitude, latitude],
  ];

  for (const [routeLongitude, routeLatitude] of points) {
    bounds[0][0] = Math.min(bounds[0][0], routeLongitude);
    bounds[0][1] = Math.min(bounds[0][1], routeLatitude);
    bounds[1][0] = Math.max(bounds[1][0], routeLongitude);
    bounds[1][1] = Math.max(bounds[1][1], routeLatitude);
  }

  return bounds;
}

function focusCorridor(
  map: MapLibreMap,
  points: readonly GeographicPoint[],
  detailsOpen: boolean,
  duration: number,
) {
  const width = map.getContainer().clientWidth;
  const drawerWidth = width < 640 ? width / 2 : 320;

  const controls = map
    .getContainer()
    .querySelector<HTMLElement>(".maplibregl-ctrl-top-right");

  if (controls) controls.style.right = detailsOpen ? `${drawerWidth}px` : "";

  map.fitBounds(corridorBounds(points), {
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
  corridor,
  points,
  detailsOpen,
}: {
  corridor: Corridor;
  points: readonly GeographicPoint[];
  detailsOpen: boolean;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectionRef = useRef({ corridor, points, detailsOpen });

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

        const { corridor, points, detailsOpen } = selectionRef.current;

        map.addSource("corridor-routes", {
          type: "geojson",
          data: corridorFeature(corridor, points),
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

        focusCorridor(map, points, detailsOpen, 0);
      });
    }

    function handleResize() {
      if (!mapRef.current?.getLayer("corridor-routes-line")) return;

      const { points, detailsOpen } = selectionRef.current;

      focusCorridor(mapRef.current, points, detailsOpen, 0);
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
    const previous = selectionRef.current;

    selectionRef.current = { corridor, points, detailsOpen };

    if (!mapRef.current?.getLayer("corridor-routes-line")) return;

    if (previous.corridor !== corridor || previous.points !== points) {
      mapRef.current
        .getSource<GeoJSONSource>("corridor-routes")
        ?.setData(corridorFeature(corridor, points));
    }

    // Refreshing an observation should update its line without undoing a pan
    // or zoom. Reframe only when selection or the drawer's footprint changes.
    if (previous.corridor === corridor && previous.detailsOpen === detailsOpen)
      return;

    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 650;

    focusCorridor(mapRef.current, points, detailsOpen, duration);
  }, [corridor, points, detailsOpen]);

  return (
    <section
      ref={containerRef}
      className="h-full w-full"
      aria-label="Mapa interactivo de Lima, Perú"
    />
  );
}
