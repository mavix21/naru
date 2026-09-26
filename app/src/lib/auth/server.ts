import "server-only";
import type { z } from "zod";

import { auth } from "@clerk/nextjs/server";

export async function sessionIdentity() {
  const session = await auth();

  if (!session.userId) return null;

  const getToken = async () => {
    const token =
      session.sessionClaims?.aud === "convex"
        ? await session.getToken()
        : await session.getToken({ template: "convex" });

    if (!token) throw new Error("Your session is still loading. Please retry.");

    return token;
  };

  return { userId: session.userId, token: await getToken(), getToken };
}

export function serverKey() {
  const key = process.env.NARU_PAYMENTS_KEY;

  if (!key || key.length < 32)
    throw new Error("Set NARU_PAYMENTS_KEY on the app and Convex deployment.");

  return key;
}

export async function requireRequest(request: Request, payments = false) {
  const session = await sessionIdentity();

  if (!session) throw new Error("Sign in to continue.");

  if (request.headers.get("X-Naru-User") !== session.userId)
    throw new Error("Your session changed. Refresh before continuing.");

  const origin = new URL(
    process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000",
  );

  if (request.headers.get("host") !== origin.host)
    throw new Error("This host is not configured for Naru.");

  if (
    request.method !== "GET" &&
    (request.headers.get("origin") !== origin.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    throw new Error("Same-origin JSON requests required.");

  if (
    payments &&
    !(
      process.env.NODE_ENV === "development" && origin.hostname === "localhost"
    ) &&
    (process.env.NARU_SMART_ACCOUNT_ENABLED !== "true" ||
      origin.protocol !== "https:")
  )
    throw new Error("Payments are not enabled on this host.");

  return session;
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 40_000,
): Promise<T> {
  const reader = request.body?.getReader();

  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      size += value.byteLength;

      if (size > limit) {
        await reader.cancel();
        throw new Error("Request too large.");
      }

      chunks.push(value);
    }

    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    reader.releaseLock();
  }
}
