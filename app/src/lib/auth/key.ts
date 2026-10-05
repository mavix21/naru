import "server-only";

// Shared by authenticated HTTP handlers and the existing sponsor's operator
// runner. Reading its server credential does not require a browser/Clerk request.
export function serverKey() {
  const key = process.env.NARU_PAYMENTS_KEY;

  if (!key || key.length < 32)
    throw new Error("Set NARU_PAYMENTS_KEY on the app and Convex deployment.");

  return key;
}
