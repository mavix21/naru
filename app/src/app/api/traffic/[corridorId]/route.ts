import { corridors } from "@/domain/corridors";
import { fetchCorridorTraffic } from "@/services/tomtom-routing";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ corridorId: string }> },
) {
  const { corridorId } = await params;
  const corridor = corridors.find((item) => item.id === corridorId);

  if (!corridor) {
    return Response.json(
      { status: "unavailable" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const result = await fetchCorridorTraffic(
    corridor.routes[0],
    process.env.TOMTOM_API_KEY,
    request.signal,
  );

  const status =
    result.status === "ready"
      ? 200
      : result.status === "provider-error"
        ? 502
        : 503;

  return Response.json(result, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
