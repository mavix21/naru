import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./access";
import {
  cleanBio,
  cleanDisplayName,
  cleanUsername,
  normalizeUsername,
  usernamePattern,
} from "./profileRules";
import { throttle } from "./socialShared";
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

// This is the entire anonymous projection. Never return a profile document,
// social person (which contains an internal ID), or payment record here.
export const publicByUsername = query({
  args: { username: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      username: v.string(),
      displayName: v.string(),
      bio: v.string(),
      companion: v.object({
        name: v.string(),
        accent: v.union(
          v.literal("sky"),
          v.literal("coral"),
          v.literal("sunshine"),
        ),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const username = normalizeUsername(args.username);

    if (!usernamePattern.test(username)) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    if (!profile) return null;

    const companion = await ctx.db
      .query("companions")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", profile.clerkUserId),
      )
      .unique();

    return {
      username: profile.username!,
      displayName: profile.displayName || profile.username!,
      bio: profile.bio || "",
      companion: {
        name: companion?.name ?? "Naru",
        accent: companion?.accent ?? ("sky" as const),
      },
    };
  },
});

export const updatePublic = mutation({
  args: { displayName: v.string(), bio: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await findProfile(ctx, await requireUser(ctx));

    if (!profile) throw new ConvexError("PROFILE_NOT_FOUND");
    await ctx.db.patch(profile._id, {
      displayName: cleanDisplayName(args.displayName),
      bio: cleanBio(args.bio),
      updatedAt: Date.now(),
    });

    return null;
  },
});

const serverIdentity = { key: v.string(), clerkUserId: v.string() };

// Only the trusted app server can seed identity, using a freshly fetched Clerk
// user. Browser JWT username/name claims and unsafeMetadata are not authority.
export const seedIdentity = mutation({
  args: { ...serverIdentity, suggestedName: v.string() },
  handler: async (ctx, { key, clerkUserId, suggestedName }) => {
    requireServer(key);
    let profile = await findProfile(ctx, clerkUserId);
    const now = Date.now();

    if (!profile) {
      const id = await ctx.db.insert("profiles", {
        clerkUserId,
        createdAt: now,
        updatedAt: now,
        preferredGreeting: "Hello",
        onboardingStatus: "incomplete",
        displayName: cleanDisplayName(suggestedName),
      });

      profile = (await ctx.db.get(id))!;
    } else if (!profile.displayName) {
      await ctx.db.patch(profile._id, {
        displayName: cleanDisplayName(suggestedName),
        updatedAt: now,
      });
    }

    const pending = await ctx.db
      .query("usernameClaims")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    return {
      username: profile.username ?? null,
      pendingUsername: pending?.username ?? null,
    };
  },
});

export const prepareUsername = mutation({
  args: { ...serverIdentity, username: v.string() },
  handler: async (ctx, { key, clerkUserId, username: input }) => {
    requireServer(key);
    const profile = await findProfile(ctx, clerkUserId);

    if (!profile) throw new ConvexError("PROFILE_NOT_FOUND");

    // Existing handles always win, including legacy reserved names. The app
    // offers completion, not renaming; stale Clerk events cannot replace them.
    if (profile.username) return { username: profile.username, claimId: null };

    const pending = await ctx.db
      .query("usernameClaims")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (pending) return { username: pending.username, claimId: pending._id };
    const username = cleanUsername(input);

    const owner = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    const reservation = await ctx.db
      .query("usernameClaims")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    if (owner || reservation)
      throw new ConvexError("That username is already taken. Choose another.");
    await throttle(ctx, `username:${clerkUserId}`, 6);

    const claimId = await ctx.db.insert("usernameClaims", {
      clerkUserId,
      username,
    });

    return { username, claimId };
  },
});

export const finishUsername = mutation({
  args: {
    ...serverIdentity,
    claimId: v.id("usernameClaims"),
    username: v.string(),
  },
  handler: async (ctx, { key, clerkUserId, claimId, username }) => {
    requireServer(key);
    const profile = await findProfile(ctx, clerkUserId);

    if (!profile) throw new ConvexError("PROFILE_NOT_FOUND");

    if (profile.username === username) return;
    const claim = await ctx.db.get(claimId);

    if (
      profile.username ||
      claim?.clerkUserId !== clerkUserId ||
      claim.username !== username
    )
      throw new ConvexError(
        "This claim changed. Retry username synchronization.",
      );

    const owner = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    if (owner) throw new ConvexError("That username is already taken.");

    const companion = await ctx.db
      .query("companions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    await ctx.db.patch(profile._id, {
      username,
      updatedAt: Date.now(),
      onboardingStatus: companion ? "complete" : profile.onboardingStatus,
    });
    await ctx.db.delete(claimId);
  },
});

export const releaseUsername = mutation({
  args: { ...serverIdentity, claimId: v.id("usernameClaims") },
  handler: async (ctx, { key, clerkUserId, claimId }) => {
    requireServer(key);
    const claim = await ctx.db.get(claimId);

    if (claim?.clerkUserId === clerkUserId) await ctx.db.delete(claimId);
  },
});
