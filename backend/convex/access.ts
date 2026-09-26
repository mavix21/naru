import { ConvexError } from "convex/values";

import type { QueryCtx } from "./_generated/server";

export async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw new ConvexError("Sign in to continue.");

  return identity.subject;
}

export function requireServer(key: string) {
  const expected = process.env.NARU_PAYMENTS_KEY;

  if (!expected || expected.length < 32 || key !== expected)
    throw new ConvexError("Trusted server access required.");
}
