import { corridors } from "../../app/src/domain/corridors";
import { fetchCorridorTraffic } from "../../app/src/services/tomtom-routing";

// Synthetic provider responses are exclusively test fixtures, never app data.
export function tomtomTrafficFixture(route = corridors[0].routes[0]) {
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

export async function trafficFixture(
  corridor = corridors[0],
  travelTime = 2520,
) {
  const route = corridor.routes[0];
  const fixture = tomtomTrafficFixture(route);

  fixture.routes[0].summary.travelTimeInSeconds = travelTime;

  return fetchCorridorTraffic(
    route,
    "test-only-key",
    new AbortController().signal,
    async () => Response.json(fixture),
  );
}
