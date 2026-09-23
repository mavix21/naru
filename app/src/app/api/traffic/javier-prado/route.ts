import { fetchJavierPradoTraffic } from "@/services/tomtom-routing";

export async function GET(request: Request) {
  const result = await fetchJavierPradoTraffic(
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
