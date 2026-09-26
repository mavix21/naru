import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";

const settings = {
  name: v.string(),
  accent: v.union(v.literal("sky"), v.literal("coral"), v.literal("sunshine")),
};

async function userId(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw new ConvexError("UNAUTHENTICATED");

  return identity.subject;
}

function find(ctx: QueryCtx, clerkUserId: string) {
  return ctx.db
    .query("companions")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

function cleanName(name: string) {
  const trimmed = name.trim();

  if (!trimmed || trimmed.length > 32 || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    throw new ConvexError("Choose a name between 1 and 32 characters.");
  }

  return trimmed;
}

export const current = query({
  args: {},
  handler: async (ctx) => find(ctx, await userId(ctx)),
});

export const save = mutation({
  args: settings,
  handler: async (ctx, args) => {
    const clerkUserId = await userId(ctx);
    const existing = await find(ctx, clerkUserId);

    // Serializable indexed reads make concurrent saves idempotent. An old
    // anonymous draft can never update an already-saved companion.
    if (existing) return existing._id;

    const name = cleanName(args.name);
    const now = Date.now();

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (profile) {
      await ctx.db.patch(profile._id, {
        onboardingStatus: "complete",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("profiles", {
        clerkUserId,
        createdAt: now,
        updatedAt: now,
        preferredGreeting: "Hello",
        onboardingStatus: "complete",
      });
    }

    return ctx.db.insert("companions", {
      clerkUserId,
      name,
      accent: args.accent,
      paymentChoiceMade: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: settings,
  handler: async (ctx, args) => {
    const companion = await find(ctx, await userId(ctx));

    if (!companion) throw new ConvexError("COMPANION_NOT_FOUND");
    await ctx.db.patch(companion._id, {
      name: cleanName(args.name),
      accent: args.accent,
      updatedAt: Date.now(),
    });
  },
});

export const finishPaymentPrompt = mutation({
  args: {},
  handler: async (ctx) => {
    const companion = await find(ctx, await userId(ctx));

    if (!companion) throw new ConvexError("COMPANION_NOT_FOUND");
    await ctx.db.patch(companion._id, {
      paymentChoiceMade: true,
      updatedAt: Date.now(),
    });
  },
});
