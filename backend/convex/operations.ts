import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer, requireUser } from "./access";

async function owned(ctx: QueryCtx, id: Id<"operations">) {
  const row = await ctx.db.get(id);

  if (!row || row.clerkUserId !== (await requireUser(ctx)))
    throw new ConvexError("Operation not found.");

  return row;
}

function payment(ctx: QueryCtx, user: string) {
  return ctx.db
    .query("payments")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();
}

// Only the authenticated server may perform an exact Clerk identity lookup.
export const recipient = query({
  args: { key: v.string(), user: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const sender = await requireUser(ctx);

    if (sender === args.user) return null;
    const row = await payment(ctx, args.user);

    const companion = await ctx.db
      .query("companions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.user))
      .unique();

    return companion &&
      row?.state === "ready" &&
      row.account &&
      row.credentialId &&
      row.publicKey
      ? { account: row.account }
      : null;
  },
});

export const get = query({
  args: { id: v.id("operations") },
  handler: (ctx, { id }) => owned(ctx, id),
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const [recent, pending] = await Promise.all([
      ctx.db
        .query("operations")
        .withIndex("by_owner", (q) => q.eq("clerkUserId", user))
        .order("desc")
        .take(20),
      ctx.db
        .query("operations")
        .withIndex("by_owner_state", (q) =>
          q.eq("clerkUserId", user).eq("state", "submitting"),
        )
        .collect(),
    ]);

    return [
      ...new Map([...pending, ...recent].map((row) => [row._id, row])).values(),
    ].sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const prepare = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    recipientUserId: v.string(),
    recipientEmail: v.string(),
    recipientName: v.string(),
    recipient: v.string(),
    account: v.string(),
    token: v.string(),
    amount: v.string(),
    units: v.string(),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);

    const previous = await ctx.db
      .query("operations")
      .withIndex("by_turn", (q) =>
        q.eq("clerkUserId", user).eq("messageId", args.messageId),
      )
      .unique();

    if (previous) return previous._id;

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
      .unique();

    if (
      conversation?.activeTurn !== args.messageId ||
      conversation.activeUntil < Date.now()
    )
      throw new ConvexError("This reply expired. Ask again.");

    const [sender, recipient] = await Promise.all([
      payment(ctx, user),
      payment(ctx, args.recipientUserId),
    ]);

    if (
      sender?.state !== "ready" ||
      sender.account !== args.account ||
      recipient?.state !== "ready" ||
      recipient.account !== args.recipient ||
      user === args.recipientUserId
    )
      throw new ConvexError("Both Naru payment accounts must be active.");

    if (
      !/^[1-9]\d{0,37}$/.test(args.units) ||
      BigInt(args.units) > (BigInt(1) << BigInt(127)) - BigInt(1)
    )
      throw new ConvexError("Invalid asset units.");
    const { key: _key, ...fields } = args;

    return ctx.db.insert("operations", {
      ...fields,
      clerkUserId: user,
      asset: "XLM",
      revision: 1,
      state: "awaiting_approval",
      reviewId: null,
      hash: null,
      error: null,
      updatedAt: Date.now(),
    });
  },
});

export const change = mutation({
  args: {
    key: v.string(),
    id: v.id("operations"),
    revision: v.number(),
    action: v.union(
      v.object({
        kind: v.literal("edit"),
        amount: v.string(),
        units: v.string(),
      }),
      v.object({ kind: v.literal("cancel") }),
      v.object({ kind: v.literal("bind"), reviewId: v.string() }),
      v.object({ kind: v.literal("submit"), reviewId: v.string() }),
      v.object({
        kind: v.literal("report"),
        reviewId: v.string(),
        state: v.union(
          v.literal("submitting"),
          v.literal("confirmed"),
          v.literal("failed"),
        ),
        hash: v.union(v.string(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const row = await owned(ctx, args.id);
    const action = args.action;

    if (row.revision !== args.revision)
      throw new ConvexError(
        "This review changed. Read the updated card before confirming.",
      );

    if (action.kind === "report") {
      if (row.reviewId !== action.reviewId || row.state !== "submitting")
        return;
      await ctx.db.patch(row._id, {
        state: action.state,
        hash: action.hash,
        error: action.error,
        updatedAt: Date.now(),
      });

      return;
    }

    if (row.state !== "awaiting_approval")
      throw new ConvexError(
        "This operation is no longer awaiting approval. Check its status.",
      );

    if (action.kind === "submit") {
      if (row.reviewId !== action.reviewId)
        throw new ConvexError(
          "Authorization does not match the current review.",
        );
      await ctx.db.patch(row._id, {
        state: "submitting",
        updatedAt: Date.now(),
      });
    } else if (action.kind === "bind") {
      await ctx.db.patch(row._id, {
        reviewId: action.reviewId,
        updatedAt: Date.now(),
      });
    } else if (action.kind === "cancel") {
      await ctx.db.patch(row._id, {
        state: "cancelled",
        revision: row.revision + 1,
        reviewId: null,
        updatedAt: Date.now(),
      });
    } else {
      if (!/^[1-9]\d{0,37}$/.test(action.units))
        throw new ConvexError("Invalid asset units.");
      await ctx.db.patch(row._id, {
        amount: action.amount,
        units: action.units,
        revision: row.revision + 1,
        reviewId: null,
        updatedAt: Date.now(),
      });
    }
  },
});
