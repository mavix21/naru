import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { profileValidator } from "./validators";

async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw new ConvexError("UNAUTHENTICATED");

  return identity.subject;
}

function findProfile(ctx: QueryCtx, clerkUserId: string) {
  return ctx.db
    .query("profiles")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

export const current = query({
  args: {},
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx) => findProfile(ctx, await requireUser(ctx)),
});

export const ensure = mutation({
  args: {},
  returns: v.id("profiles"),
  handler: async (ctx) => {
    const clerkUserId = await requireUser(ctx);
    const existing = await findProfile(ctx, clerkUserId);

    if (existing) return existing._id;

    // The indexed read and insert share one serializable transaction. Convex
    // retries conflicting mutations, including concurrent first-time requests.
    const now = Date.now();

    return ctx.db.insert("profiles", {
      clerkUserId,
      createdAt: now,
      updatedAt: now,
      preferredGreeting: "Hello",
      onboardingStatus: "incomplete",
    });
  },
});

export const updatePreference = mutation({
  args: { preferredGreeting: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await findProfile(ctx, await requireUser(ctx));

    if (!profile) throw new ConvexError("PROFILE_NOT_FOUND");
    const preferredGreeting = args.preferredGreeting.trim();

    if (preferredGreeting.length < 1 || preferredGreeting.length > 80) {
      throw new ConvexError("Greeting must contain 1–80 characters.");
    }

    await ctx.db.patch(profile._id, {
      preferredGreeting,
      updatedAt: Date.now(),
    });

    return null;
  },
});
