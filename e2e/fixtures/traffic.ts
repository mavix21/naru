import { corridors } from "../../app/src/domain/corridors";

// Synthetic provider responses are exclusively test fixtures, never app data.
export function tomtomTrafficFixture() {
  const route = corridors.find((corridor) => corridor.id === "javier-prado")
    ?.routes[0];

  if (!route) throw new Error("Missing Javier Prado test corridor");

  const points = route.points.map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));

  return {
    routes: [
      {
        summary: {
          lengthInMeters: 7100,
          travelTimeInSeconds: 2520,
          trafficDelayInSeconds: 720,
          noTrafficTravelTimeInSeconds: 1680,
          historicTrafficTravelTimeInSeconds: 2160,
          liveTrafficIncidentsTravelTimeInSeconds: 2460,
        },
        legs: [{ points }],
      },
    ],
  };
}
