import { ConvexError } from "convex/values";
import { z } from "zod";

import { readJson } from "@/lib/auth/server";
import { SponsorStore } from "@/lib/smart-account/server/store";
import { TipError, TipService } from "@/lib/tips/server";
import {
  checkoutId,
  type TipReview,
  type TipStatus,
  type TrustlineResult,
} from "@/lib/tips/shared";

export const maxDuration = 60;

// Guest checkout: no Naru session. Access is the opaque checkout capability,
// a same-origin JSON boundary, and per-IP/per-wallet/global rate limits.
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare"),
      username: z.string().min(3).max(24),
      sender: z.string().length(56),
      amount: z.string().max(40),
    })
    .strict(),
  z
    .object({
      action: z.literal("trustline"),
      sender: z.string().length(56),
    })
    .strict(),
  z
    .object({
      action: z.literal("trust"),
      sender: z.string().length(56),
      xdr: z.string().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("submit"),
      checkout: checkoutId,
      xdr: z.string().min(1).max(30_000),
    })
    .strict(),
]);

function reply(
  body:
    | TipReview
    | TipStatus
    | TrustlineResult
    | { error: string; reason?: string },
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

function origin() {
  return new URL(
    process.env.NARU_PUBLIC_ORIGIN ||
      process.env.NARU_SMART_ACCOUNT_ORIGIN ||
      "http://localhost:3000",
  );
}

function client(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 64);
}

async function limit(request: Request, action: string, maximum: number) {
  const minute = Math.floor(Date.now() / 60_000);
  const store = new SponsorStore();

  try {
    await store.rate(`tips:${action}:${minute}`, maximum * 20);
    await store.rate(`tips:${action}:${client(request)}:${minute}`, maximum);
  } catch {
    throw new Error("Too many tip attempts right now. Please wait a minute.");
  }
}

async function handle(request: Request) {
  const expected = origin();

  if (request.headers.get("host") !== expected.host)
    return reply({ error: "Not found" }, 404);

  if (
    request.method === "POST" &&
    (request.headers.get("origin") !== expected.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    return reply({ error: "Same-origin JSON requests required." }, 403);

  try {
    const service = new TipService();

    if (request.method === "GET") {
      const checkout = checkoutId.parse(
        new URL(request.url).searchParams.get("checkout"),
      );

      await limit(request, "status", 60);

      return reply(await service.status(checkout));
    }

    const body = await readJson(request, input, 40_000);

    if (body.action === "prepare") {
      await limit(request, "prepare", 10);

      return reply(
        await service.prepare({
          username: body.username,
          sender: body.sender,
          amount: body.amount,
        }),
      );
    }

    if (body.action === "trustline") {
      await limit(request, "trustline", 10);

      return reply(await service.trustline(body.sender));
    }

    if (body.action === "trust") {
      await limit(request, "trust", 6);

      return reply(await service.trust(body.sender, body.xdr));
    }

    await limit(request, "submit", 10);

    return reply(await service.submit(body.checkout, body.xdr));
  } catch (error) {
    const message =
      error instanceof ConvexError
        ? String(error.data)
        : error instanceof z.ZodError
          ? "Check the tip details and try again."
          : error instanceof Error
            ? error.message
            : "Couldn’t process this tip. Nothing was sent.";

    return reply(
      {
        error: message.slice(0, 400),
        reason: error instanceof TipError ? error.reason : undefined,
      },
      400,
    );
  }
}

export const GET = handle;

export const POST = handle;
