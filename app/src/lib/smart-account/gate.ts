import { timingSafeEqual } from "node:crypto";

export function gateSettings() {
  return {
    development: process.env.NODE_ENV === "development",
    enabled: process.env.NARU_SMART_ACCOUNT_ENABLED === "true",
    origin: process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000",
    token: process.env.NARU_SMART_ACCOUNT_ACCESS_TOKEN || "",
  };
}

export function gateStatus(headers: Headers, settings = gateSettings()) {
  let origin: URL;

  try {
    origin = new URL(settings.origin);
  } catch {
    return 404;
  }

  if (headers.get("host") !== origin.host) return 404;

  if (settings.development && origin.hostname === "localhost") return 200;

  if (
    !settings.enabled ||
    settings.token.length < 32 ||
    origin.protocol !== "https:"
  )
    return 404;
  const supplied = Buffer.from(headers.get("authorization") || "");

  const expected = Buffer.from(
    `Basic ${Buffer.from(`naru:${settings.token}`).toString("base64")}`,
  );

  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
    ? 200
    : 401;
}

export function gateResponse(status: number) {
  const headers = new Headers({ "Cache-Control": "no-store" });

  if (status === 401)
    headers.set(
      "WWW-Authenticate",
      'Basic realm="Naru testnet", charset="UTF-8"',
    );

  return new Response(
    status === 401 ? "Naru testnet validation access required" : "Not found",
    {
      status,
      headers,
    },
  );
}
