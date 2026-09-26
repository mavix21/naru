import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { displayAmount, equalShares, parseAmount } from "./money";
import {
  deliver,
  profileFor,
  publicPerson,
  requireFriend,
  socialUser,
  throttle,
} from "./socialShared";

const draftFields = {
  title: v.string(),
  total: v.string(),
  participantIds: v.array(v.id("profiles")),
  includeSelf: v.boolean(),
  mode: v.union(v.literal("collect"), v.literal("reimburse")),
};

function payment(ctx: QueryCtx, user: string) {
  return ctx.db
    .query("payments")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();
}

async function buildDraft(
  ctx: QueryCtx,
  me: Doc<"profiles">,
  args: {
    title: string;
    total: string;
    participantIds: Id<"profiles">[];
    includeSelf: boolean;
    mode: "collect" | "reimburse";
  },
) {
  const title = args.title.trim();

  if (!title || title.length > 100 || /[\p{Cc}\p{Cf}]/u.test(title))
    throw new ConvexError("Give this split a title of 1–100 characters.");

  if (
    !args.participantIds.length ||
    args.participantIds.length > 12 ||
    new Set(args.participantIds).size !== args.participantIds.length
  )
    throw new ConvexError("Choose 1–12 distinct friends.");

  for (const id of args.participantIds) await requireFriend(ctx, me._id, id);
  const parsed = parseAmount(args.total);

  const shares = await Promise.all(
    equalShares(parsed.amount, [
      ...args.participantIds,
      ...(args.includeSelf ? [me._id] : []),
    ]).map(async (share) => ({
      person: await publicPerson(ctx, share.userId),
      units: share.units,
    })),
  );

  return {
    title,
    total: parsed.amount,
    units: parsed.units,
    shares,
    participantIds: args.participantIds,
    includeSelf: args.includeSelf,
    mode: args.mode,
  };
}

export async function requestAccess(ctx: QueryCtx, id: Id<"paymentRequests">) {
  const me = await profileFor(ctx, await requireUser(ctx));
  const request = await ctx.db.get(id);

  if (
    !me ||
    !request ||
    (me._id !== request.organizerId && me._id !== request.participantId)
  )
    throw new ConvexError("Request not found.");
  const split = await ctx.db.get(request.splitId);

  if (!split || split.state !== "sent")
    throw new ConvexError("Split not found.");

  return { me, request, split };
}

export const prepare = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    token: v.string(),
    ...draftFields,
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const me = await socialUser(ctx);

    const previous = await ctx.db
      .query("splits")
      .withIndex("by_turn", (q) =>
        q.eq("clerkUserId", me.clerkUserId).eq("messageId", args.messageId),
      )
      .unique();

    if (previous) return previous._id;

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", me.clerkUserId))
      .unique();

    if (
      !conversation ||
      conversation.activeTurn !== args.messageId ||
      conversation.activeUntil < Date.now()
    )
      throw new ConvexError("This reply expired. Ask again.");

    const message = await ctx.db
      .query("messages")
      .withIndex("by_message", (q) =>
        q
          .eq("conversationId", conversation._id)
          .eq("messageId", args.messageId),
      )
      .unique();

    const selected = new Set(message?.mentions?.map((m) => m.userId));

    if (args.participantIds.some((id) => !selected.has(id)))
      throw new ConvexError(
        "Select every participant using @mentions in your message.",
      );
    const fields = await buildDraft(ctx, me, args);
    const organizer = await publicPerson(ctx, me._id);

    const id = await ctx.db.insert("splits", {
      ...fields,
      clerkUserId: me.clerkUserId,
      organizer,
      messageId: args.messageId,
      asset: "XLM",
      token: args.token,
      state: "draft",
      revision: 1,
      updatedAt: Date.now(),
    });

    await deliver(
      ctx,
      me.clerkUserId,
      `split:${id}:review`,
      { kind: "split_review", actor: organizer, splitId: id },
      false,
    );

    return id;
  },
});

export const get = query({
  args: { id: v.id("splits") },
  handler: async (ctx, { id }) => {
    const me = await profileFor(ctx, await requireUser(ctx));
    const split = await ctx.db.get(id);

    if (
      !me ||
      !split ||
      (split.organizer.userId !== me._id &&
        (split.state !== "sent" || !split.participantIds.includes(me._id)))
    )
      throw new ConvexError("Split not found.");

    const requests = await ctx.db
      .query("paymentRequests")
      .withIndex("by_split", (q) => q.eq("splitId", id))
      .collect();

    return { split, requests, isOrganizer: me._id === split.organizer.userId };
  },
});

export const edit = mutation({
  args: { id: v.id("splits"), revision: v.number(), ...draftFields },
  handler: async (ctx, args) => {
    const me = await socialUser(ctx);
    const split = await ctx.db.get(args.id);

    if (
      !split ||
      split.clerkUserId !== me.clerkUserId ||
      split.state !== "draft" ||
      split.revision !== args.revision
    )
      throw new ConvexError("This split changed. Read its latest review.");
    const fields = await buildDraft(ctx, me, args);
    await ctx.db.patch(split._id, {
      ...fields,
      revision: split.revision + 1,
      updatedAt: Date.now(),
    });
  },
});

export const confirm = mutation({
  args: { id: v.id("splits"), revision: v.number() },
  handler: async (ctx, { id, revision }) => {
    const me = await socialUser(ctx);
    const split = await ctx.db.get(id);

    if (!split || split.clerkUserId !== me.clerkUserId)
      throw new ConvexError("Split not found.");

    if (split.state === "sent") return id;

    if (split.revision !== revision)
      throw new ConvexError("This split changed. Review it again.");

    for (const participant of split.participantIds)
      await requireFriend(ctx, me._id, participant);
    const account = await payment(ctx, me.clerkUserId);

    if (
      account?.state !== "ready" ||
      !account.account ||
      !account.credentialId ||
      !account.publicKey
    )
      throw new ConvexError(
        "Activate payments before collecting money. Your split is saved.",
      );
    await throttle(ctx, `split:${me._id}`, 10, 3_600_000);
    await ctx.db.patch(id, {
      state: "sent",
      organizerAccount: account.account,
      updatedAt: Date.now(),
    });

    for (const share of split.shares) {
      if (share.person.userId === me._id) continue;
      const participant = (await ctx.db.get(share.person.userId))!;

      const requestId = await ctx.db.insert("paymentRequests", {
        splitId: id,
        organizerId: me._id,
        participantId: participant._id,
        amount: displayAmount(share.units),
        units: share.units,
        state: "outstanding",
        updatedAt: Date.now(),
      });

      await deliver(ctx, participant.clerkUserId, `request:${requestId}`, {
        kind: "split_request",
        actor: split.organizer,
        splitId: id,
        requestId,
      });
    }

    return id;
  },
});

export const request = query({
  args: { id: v.id("paymentRequests") },
  handler: async (ctx, { id }) => {
    const { me, request, split } = await requestAccess(ctx, id);

    const operation = request.operationId
      ? await ctx.db.get(request.operationId)
      : null;

    return {
      request,
      split,
      isOrganizer: me._id === request.organizerId,
      me: await publicPerson(ctx, me._id),
      other: await publicPerson(
        ctx,
        me._id === request.organizerId
          ? request.participantId
          : request.organizerId,
      ),
      operation: me._id === request.participantId ? operation : null,
    };
  },
});

export const requestAction = mutation({
  args: {
    id: v.id("paymentRequests"),
    action: v.union(v.literal("decline"), v.literal("cancel")),
  },
  handler: async (ctx, { id, action }) => {
    const { me, request, split } = await requestAccess(ctx, id);

    if (
      action === "cancel"
        ? me._id !== request.organizerId
        : me._id !== request.participantId
    )
      throw new ConvexError("You can’t change this request.");
    const state = action === "cancel" ? "cancelled" : "declined";

    if (request.state === state) return;

    if (
      request.state === "paid" ||
      request.state === "submitting" ||
      request.state === "cancelled"
    )
      throw new ConvexError(
        "This request is paid, pending, or cancelled. Its payment record is preserved.",
      );

    const operation = request.operationId
      ? await ctx.db.get(request.operationId)
      : null;

    if (operation?.state === "awaiting_approval")
      await ctx.db.patch(operation._id, {
        state: "cancelled",
        reviewId: null,
        revision: operation.revision + 1,
        updatedAt: Date.now(),
      });
    await ctx.db.patch(id, { state, updatedAt: Date.now() });

    const otherId =
      me._id === request.organizerId
        ? request.participantId
        : request.organizerId;

    const other = (await ctx.db.get(otherId))!;
    await deliver(ctx, other.clerkUserId, `request:${id}:${state}`, {
      kind: state,
      actor: await publicPerson(ctx, me._id),
      requestId: id,
      splitId: split._id,
    });
  },
});

export const context = query({
  args: {},
  handler: async (ctx) => {
    const me = await profileFor(ctx, await requireUser(ctx));

    if (!me?.username) return [];

    const own = await ctx.db
      .query("splits")
      .withIndex("by_owner", (q) => q.eq("clerkUserId", me.clerkUserId))
      .order("desc")
      .take(20);

    const incoming = await ctx.db
      .query("paymentRequests")
      .withIndex("by_participant", (q) => q.eq("participantId", me._id))
      .order("desc")
      .take(40);

    const outgoing = (
      await Promise.all(
        own
          .filter((s) => s.state === "sent")
          .map((s) =>
            ctx.db
              .query("paymentRequests")
              .withIndex("by_split", (q) => q.eq("splitId", s._id))
              .collect(),
          ),
      )
    ).flat();

    return Promise.all(
      [...incoming, ...outgoing].map(async (r) => {
        const s = (await ctx.db.get(r.splitId))!;

        return {
          requestId: r._id,
          title: s.title,
          amount: r.amount,
          asset: s.asset,
          state: r.state,
          direction: r.participantId === me._id ? "incoming" : "outgoing",
          other: await publicPerson(
            ctx,
            r.participantId === me._id ? r.organizerId : r.participantId,
          ),
        };
      }),
    );
  },
});
