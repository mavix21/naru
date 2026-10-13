import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireServer } from "./access";
import { activeGoal, countContribution, publicGoal } from "./goals";
import { parseAmount, TESTNET_ASSETS } from "./money";
import { normalizeUsername, usernamePattern } from "./profileRules";
import { deliver, throttle } from "./socialShared";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function byCheckout(ctx: QueryCtx, checkout: string) {
  return ctx.db
    .query("tips")
    .withIndex("by_checkout", (q) => q.eq("checkout", checkout))
    .unique();
}

// Trusted server-only resolution of a public handle to its activated smart
// account. The page receives only `available`; never the payment record.
export const recipient = query({
  args: { key: v.string(), username: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const username = normalizeUsername(args.username);

    if (!usernamePattern.test(username)) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    if (!profile?.username) return null;

    const [payment, companion] = await Promise.all([
      ctx.db
        .query("payments")
        .withIndex("by_clerk_user", (q) =>
          q.eq("clerkUserId", profile.clerkUserId),
        )
        .unique(),
      ctx.db
        .query("companions")
        .withIndex("by_clerk_user", (q) =>
          q.eq("clerkUserId", profile.clerkUserId),
        )
        .unique(),
    ]);

    if (
      !companion ||
      payment?.state !== "ready" ||
      !payment.account ||
      !payment.credentialId ||
      !payment.publicKey
    )
      return { available: false as const, username: profile.username };

    return {
      available: true as const,
      username: profile.username,
      displayName: profile.displayName || profile.username,
      profileId: profile._id,
      userId: profile.clerkUserId,
      account: payment.account,
    };
  },
});

export const get = query({
  args: { key: v.string(), checkout: v.string() },
  handler: (ctx, { key, checkout }) => {
    requireServer(key);

    return byCheckout(ctx, checkout);
  },
});

export const create = mutation({
  args: {
    key: v.string(),
    checkout: v.string(),
    username: v.string(),
    recipientAccount: v.string(),
    sender: v.string(),
    amount: v.string(),
    units: v.string(),
    fee: v.string(),
    envelope: v.string(),
    hash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { key, username, ...args }) => {
    requireServer(key);
    await throttle(ctx, `tip:${args.sender}`, 6);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) =>
        q.eq("username", normalizeUsername(username)),
      )
      .unique();

    const payment =
      profile &&
      (await ctx.db
        .query("payments")
        .withIndex("by_clerk_user", (q) =>
          q.eq("clerkUserId", profile.clerkUserId),
        )
        .unique());

    // Re-bind inside the transaction: the recipient cannot change between the
    // server's resolution and the persisted intent.
    if (
      !profile ||
      payment?.state !== "ready" ||
      payment.account !== args.recipientAccount
    )
      throw new ConvexError("This profile can’t receive tips right now.");

    const parsed = parseAmount(args.amount, "USDC");

    if (parsed.units !== args.units || parsed.amount !== args.amount)
      throw new ConvexError("The tip amount is invalid.");

    if (args.expiresAt <= Date.now())
      throw new ConvexError("This review expired. Prepare a new one.");

    if (
      (await byCheckout(ctx, args.checkout)) ||
      (await ctx.db
        .query("tips")
        .withIndex("by_hash", (q) => q.eq("hash", args.hash))
        .first())
    )
      throw new ConvexError("This tip review already exists.");

    // Attribution is decided here, never by the browser, and never changes:
    // archiving or replacing the goal later keeps this tip bound to it.
    const goal = await activeGoal(ctx, profile._id);

    await ctx.db.insert("tips", {
      ...args,
      recipientProfileId: profile._id,
      recipientUserId: profile.clerkUserId,
      network: TESTNET_PASSPHRASE,
      token: TESTNET_ASSETS.USDC,
      goalId: goal?._id,
      state: "review",
      updatedAt: Date.now(),
    });

    return { goal: goal ? { title: goal.title } : null };
  },
});

// The goal a checkout was bound to, as public amounts only.
export const goal = query({
  args: { key: v.string(), checkout: v.string() },
  handler: async (ctx, { key, checkout }) => {
    requireServer(key);
    const tip = await byCheckout(ctx, checkout);
    const goal = tip?.goalId && (await ctx.db.get(tip.goalId));

    if (!goal) return null;

    return { ...publicGoal(goal), active: goal.state === "active" };
  },
});

// Persist the exact signed envelope before any network send. Only one signed
// envelope can ever be attached to a review, so retries never create a payment.
export const submit = mutation({
  args: { key: v.string(), checkout: v.string(), signedEnvelope: v.string() },
  handler: async (ctx, { key, checkout, signedEnvelope }) => {
    requireServer(key);
    const tip = await byCheckout(ctx, checkout);

    if (!tip) throw new ConvexError("Unknown tip review.");

    if (tip.state !== "review") return { claimed: false };

    if (tip.expiresAt <= Date.now()) {
      await ctx.db.patch(tip._id, {
        state: "failed",
        error: "This review expired before it was signed. Nothing was sent.",
        updatedAt: Date.now(),
      });

      return { claimed: false };
    }

    await ctx.db.patch(tip._id, {
      state: "pending",
      signedEnvelope,
      updatedAt: Date.now(),
    });

    // Only the caller that attached the envelope performs the first send.
    return { claimed: true };
  },
});

export const note = mutation({
  args: { key: v.string(), checkout: v.string(), error: v.string() },
  handler: async (ctx, { key, checkout, error }) => {
    requireServer(key);
    const tip = await byCheckout(ctx, checkout);

    if (tip?.state === "pending")
      await ctx.db.patch(tip._id, {
        error: error.slice(0, 400),
        updatedAt: Date.now(),
      });
  },
});

export const finish = mutation({
  args: {
    key: v.string(),
    checkout: v.string(),
    expected: v.union(v.literal("review"), v.literal("pending")),
    state: v.union(v.literal("confirmed"), v.literal("failed")),
    ledger: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { key, checkout, expected, state, ledger, error }) => {
    requireServer(key);
    const tip = await byCheckout(ctx, checkout);

    if (!tip) throw new ConvexError("Unknown tip review.");

    if (tip.state !== expected) return tip;

    if (state === "confirmed" && expected !== "pending")
      throw new ConvexError("Only a submitted tip can be confirmed.");

    await ctx.db.patch(tip._id, {
      state,
      ledger,
      error: state === "failed" ? error?.slice(0, 400) : undefined,
      updatedAt: Date.now(),
    });

    if (state === "confirmed") {
      // Same transaction as the state change: retries and concurrent
      // reconciliations see `confirmed` above and never count twice.
      const goal = await countContribution(ctx, tip);
      await deliverTip(ctx, tip, goal?.title);
    }

    return (await ctx.db.get(tip._id))!;
  },
});

async function deliverTip(
  ctx: MutationCtx,
  tip: Doc<"tips">,
  goal: string | undefined,
) {
  const companion = await ctx.db
    .query("companions")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", tip.recipientUserId))
    .unique();

  // Keyed by transaction hash: one receipt and notification per payment.
  await deliver(ctx, tip.recipientUserId, `tip:${tip.hash}`, {
    kind: "tip_received",
    actor: {
      userId: tip.recipientProfileId,
      username: "",
      displayName: `${tip.sender.slice(0, 4)}…${tip.sender.slice(-4)}`,
      companionName: companion?.name ?? "Naru",
      accent: companion?.accent ?? "sky",
    },
    tip: {
      amount: tip.amount,
      asset: "USDC",
      hash: tip.hash,
      from: tip.sender,
      goal,
    },
  });
}
