import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { deliverSplitRequest } from "./directMessages";
import {
  contractShares,
  displayAmount,
  equalShares,
  NARU_SPLIT,
  parseAmount,
  TESTNET_ASSETS,
} from "./money";
import {
  deliver,
  profileFor,
  publicPerson,
  requireFriend,
  socialUser,
  throttle,
} from "./socialShared";
import { transferAsset, walletBalances } from "./validators";

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
    asset?: "XLM" | "USDC";
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
  const asset = args.asset ?? "XLM";
  const parsed = parseAmount(args.total, asset);

  if (asset === "USDC") {
    if (!args.includeSelf || args.mode !== "reimburse")
      throw new ConvexError(
        "USDC splits reimburse an already-paid expense and must include your share.",
      );

    const people = await Promise.all(
      [me._id, ...args.participantIds].map(async (id) => {
        const profile = (await ctx.db.get(id))!;
        const account = await payment(ctx, profile.clerkUserId);

        if (
          account?.state !== "ready" ||
          !account.account ||
          !account.credentialId ||
          !account.publicKey
        )
          throw new ConvexError(
            "Everyone in this split must activate their Naru payment account first.",
          );

        return {
          person: await publicPerson(ctx, id),
          account: account.account,
        };
      }),
    );

    const shares = contractShares(
      parsed.amount,
      people.map((p) => p.account),
    ).map((share) => ({
      ...share,
      person: people.find((p) => p.account === share.account)!.person,
    }));

    return {
      title,
      total: parsed.amount,
      units: parsed.units,
      shares,
      participantIds: args.participantIds,
      includeSelf: true,
      mode: args.mode,
      organizerAccount: people[0].account,
    };
  }

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

  if (split.asset === "USDC")
    throw new ConvexError(
      "This contract request is read-only here. Use Pay my share in its friend DM.",
    );

  return { me, request, split };
}

export const prepare = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    token: v.string(),
    asset: v.optional(transferAsset),
    creationId: v.optional(v.string()),
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
    const asset = args.asset ?? "XLM";

    if (
      args.token !== TESTNET_ASSETS[asset] ||
      (asset === "USDC" && !/^[0-9a-f]{64}$/.test(args.creationId ?? ""))
    )
      throw new ConvexError("Invalid split asset or creation identifier.");

    const id = await ctx.db.insert("splits", {
      ...fields,
      clerkUserId: me.clerkUserId,
      organizer,
      messageId: args.messageId,
      asset,
      token: args.token,
      state: "draft",
      revision: 1,
      updatedAt: Date.now(),
      creation:
        asset === "USDC"
          ? { id: args.creationId!, contract: NARU_SPLIT.contract }
          : undefined,
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
        (split.asset === "USDC" ||
          split.state !== "sent" ||
          !split.participantIds.includes(me._id)))
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
    const fields = await buildDraft(ctx, me, { ...args, asset: split.asset });
    await retireReview(ctx, split);
    await ctx.db.patch(split._id, {
      ...fields,
      creation: split.creation
        ? { id: split.creation.id, contract: NARU_SPLIT.contract }
        : undefined,
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

    if (split.asset === "USDC")
      throw new ConvexError(
        "Authorize contract publication with your passkey.",
      );

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

    return (
      await Promise.all(
        [...incoming, ...outgoing].map(async (r) => {
          const s = (await ctx.db.get(r.splitId))!;

          if (s.asset === "USDC") return null;

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
      )
    ).filter((r) => r !== null);
  },
});

async function ownedContractSplit(ctx: QueryCtx, id: Id<"splits">) {
  const split = await ctx.db.get(id);

  if (
    !split ||
    split.clerkUserId !== (await requireUser(ctx)) ||
    split.asset !== "USDC" ||
    !split.creation
  )
    throw new ConvexError("Split not found.");

  return split;
}

async function retireReview(ctx: MutationCtx, split: Doc<"splits">) {
  if (!split.creation?.reviewId) return;

  const job = await ctx.db
    .query("sponsorJobs")
    .withIndex("by_intent", (q) => q.eq("id", split.creation!.reviewId!))
    .unique();

  if (job && job.state !== "failed") {
    if (job.state !== "review")
      throw new ConvexError("Publication is pending. Check its status.");
    await ctx.db.patch(job._id, {
      state: "failed",
      error: "Review replaced. Authorization invalidated.",
    });
  }
}

async function checkCurrentAccounts(ctx: QueryCtx, split: Doc<"splits">) {
  const me = (await ctx.db.get(split.organizer.userId))!;
  const current = await buildDraft(ctx, me, split);

  if (
    current.organizerAccount !== split.organizerAccount ||
    JSON.stringify(
      current.shares.map((s) => ({
        id: s.person.userId,
        units: s.units,
        account: "account" in s ? s.account : undefined,
      })),
    ) !==
      JSON.stringify(
        split.shares.map((s) => ({
          id: s.person.userId,
          units: s.units,
          account: s.account,
        })),
      )
  )
    throw new ConvexError(
      "Participant accounts changed. Save and review this split again.",
    );
}

export const publication = query({
  args: {
    key: v.string(),
    id: v.id("splits"),
    validate: v.optional(v.boolean()),
  },
  handler: async (ctx, { key, id, validate }) => {
    requireServer(key);
    const split = await ownedContractSplit(ctx, id);

    if (validate) await checkCurrentAccounts(ctx, split);

    return split;
  },
});

export const bindCreation = mutation({
  args: {
    key: v.string(),
    id: v.id("splits"),
    revision: v.number(),
    reviewId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const split = await ownedContractSplit(ctx, args.id);

    if (split.state !== "draft" || split.revision !== args.revision)
      throw new ConvexError("This split changed. Review it again.");
    await checkCurrentAccounts(ctx, split);

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", args.reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "split_create" ||
      job.account !== split.organizerAccount ||
      job.state !== "review" ||
      job.expires <= Date.now()
    )
      throw new ConvexError("Publication review unavailable.");
    await retireReview(ctx, split);
    await ctx.db.patch(split._id, {
      creation: { ...split.creation!, reviewId: job.id, error: undefined },
      updatedAt: Date.now(),
    });
  },
});

export const claimCreation = mutation({
  args: {
    key: v.string(),
    id: v.id("splits"),
    revision: v.number(),
    reviewId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const split = await ownedContractSplit(ctx, args.id);

    if (
      split.revision !== args.revision ||
      split.creation!.reviewId !== args.reviewId
    )
      throw new ConvexError("This split changed. Review it again.");

    if (split.state !== "draft") return false;
    await checkCurrentAccounts(ctx, split);

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", args.reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "split_create" ||
      job.account !== split.organizerAccount ||
      job.state !== "review" ||
      job.expires <= Date.now()
    )
      throw new ConvexError("Publication review expired. Review again.");
    await throttle(ctx, `split:${split.organizer.userId}`, 10, 3_600_000);
    await ctx.db.patch(split._id, {
      state: "submitting",
      updatedAt: Date.now(),
    });

    return true;
  },
});

export const reportCreation = mutation({
  args: {
    key: v.string(),
    id: v.id("splits"),
    revision: v.number(),
    reviewId: v.string(),
    verifiedLedger: v.optional(v.number()),
    shareStates: v.optional(
      v.array(
        v.object({
          account: v.string(),
          state: v.union(
            v.literal("outstanding"),
            v.literal("paid"),
            v.literal("cancelled"),
          ),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const split = await ownedContractSplit(ctx, args.id);

    if (
      split.revision !== args.revision ||
      split.creation!.reviewId !== args.reviewId
    )
      throw new ConvexError("Publication changed.");

    if (split.state === "sent") return;

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", args.reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "split_create" ||
      job.account !== split.organizerAccount
    )
      throw new ConvexError("Missing publication evidence.");

    if (split.state !== "submitting" && split.state !== "published")
      throw new ConvexError("Publication not authorized.");

    if (job.state === "confirmed") {
      if (
        !job.hash ||
        !job.envelope ||
        !job.ledger ||
        !args.verifiedLedger ||
        args.verifiedLedger > job.ledger
      )
        throw new ConvexError("Missing verified on-chain creation terms.");

      if (
        !args.shareStates ||
        args.shareStates.length !== split.participantIds.length ||
        new Set(args.shareStates.map((s) => s.account)).size !==
          args.shareStates.length ||
        split.shares.some(
          (s) =>
            s.person.userId !== split.organizer.userId &&
            !args.shareStates!.some((state) => state.account === s.account),
        )
      )
        throw new ConvexError("Missing verified share states.");
      await ctx.db.patch(split._id, {
        state: "published",
        shares: split.shares.map((s) => ({
          ...s,
          requestState: args.shareStates!.find(
            (state) => state.account === s.account,
          )?.state,
        })),
        creation: {
          ...split.creation!,
          hash: job.hash,
          ledger: args.verifiedLedger,
          error: undefined,
        },
        updatedAt: Date.now(),
      });
      // Persist verified publication and its outbox task atomically. Delivery can
      // be retried independently even if the HTTP worker disappears right here.
      await ctx.scheduler.runAfter(0, internal.splits.deliverPublished, {
        id: split._id,
      });
    } else if (job.state === "failed") {
      await ctx.db.patch(split._id, {
        state: "draft",
        revision: split.revision + 1,
        creation: {
          id: split.creation!.id,
          contract: split.creation!.contract,
          error: job.error ?? "Creation failed. Review again.",
        },
        updatedAt: Date.now(),
      });
    } else
      await ctx.db.patch(split._id, {
        creation: {
          ...split.creation!,
          hash: job.hash ?? undefined,
          error: job.error ?? undefined,
        },
        updatedAt: Date.now(),
      });
  },
});

export const deliverPublished = internalMutation({
  args: { id: v.id("splits") },
  handler: async (ctx, { id }) => {
    const split = await ctx.db.get(id);

    if (
      !split ||
      split.asset !== "USDC" ||
      (split.state !== "published" && split.state !== "sent") ||
      !split.creation?.hash ||
      !split.creation.ledger
    )
      throw new ConvexError("Publication not verified.");

    // All participants, typed messages, unread counters, and the delivery marker
    // commit together. No partial fan-out and no self-payment request.
    for (const share of split.shares) {
      if (share.person.userId === split.organizer.userId) continue;

      let request = await ctx.db
        .query("paymentRequests")
        .withIndex("by_split_participant", (q) =>
          q.eq("splitId", id).eq("participantId", share.person.userId),
        )
        .unique();

      if (!request) {
        const requestId = await ctx.db.insert("paymentRequests", {
          splitId: id,
          organizerId: split.organizer.userId,
          participantId: share.person.userId,
          amount: displayAmount(share.units),
          units: share.units,
          state: share.requestState ?? "outstanding",
          updatedAt: Date.now(),
        });

        request = (await ctx.db.get(requestId))!;
      }

      const directMessageId = await deliverSplitRequest(ctx, request, split);
      await ctx.db.patch(request._id, { directMessageId });
    }

    await ctx.db.patch(id, { state: "sent", updatedAt: Date.now() });
  },
});

// Operator-only pagination for the existing maintenance runner. No identity,
// balances, or private conversation history are exposed through a public query.
export const maintenanceCandidates = query({
  args: { key: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { key, paginationOpts }) => {
    requireServer(key);

    const result = await ctx.db
      .query("splits")
      .withIndex("by_asset_state", (q) =>
        q.eq("asset", "USDC").eq("state", "sent"),
      )
      .paginate({
        ...paginationOpts,
        numItems: Math.min(50, paginationOpts.numItems),
      });

    return {
      ...result,
      page: result.page.filter(
        (split) => split.creation?.contract === NARU_SPLIT.contract,
      ),
    };
  },
});

export const bindMaintenance = mutation({
  args: { key: v.string(), id: v.id("splits"), reviewId: v.string() },
  handler: async (ctx, { key, id, reviewId }) => {
    requireServer(key);
    const split = await ctx.db.get(id);

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", reviewId))
      .unique();

    if (
      !split ||
      split.state !== "sent" ||
      split.asset !== "USDC" ||
      split.creation?.contract !== NARU_SPLIT.contract ||
      !split.creation.hash ||
      !job ||
      job.kind !== "split_keep_alive" ||
      job.account !== split.organizerAccount ||
      job.state !== "review"
    )
      throw new ConvexError("Verified split maintenance is unavailable.");

    if (split.maintenanceReviewId) {
      const previous = await ctx.db
        .query("sponsorJobs")
        .withIndex("by_intent", (q) => q.eq("id", split.maintenanceReviewId!))
        .unique();

      if (
        previous &&
        (previous.state === "pending" ||
          previous.state === "preparing" ||
          (previous.state === "review" && previous.expires > Date.now()))
      )
        return previous.id;
    }

    await ctx.db.patch(id, { maintenanceReviewId: reviewId });

    return reviewId;
  },
});

export const deploymentUsage = query({
  args: { key: v.string(), contract: v.string() },
  handler: async (ctx, { key, contract }) => {
    requireServer(key);

    const rows = await ctx.db
      .query("splits")
      .withIndex("by_asset_state", (q) => q.eq("asset", "USDC"))
      .collect();

    const counts = { draft: 0, submitting: 0, published: 0, sent: 0 };

    for (const row of rows)
      if (row.creation?.contract === contract) counts[row.state]++;

    return counts;
  },
});

async function contractRequestAccess(
  ctx: QueryCtx,
  id: Id<"paymentRequests">,
  currentContract = true,
) {
  const me = await profileFor(ctx, await requireUser(ctx));
  const request = await ctx.db.get(id);

  if (
    !me ||
    !request ||
    (me._id !== request.organizerId && me._id !== request.participantId)
  )
    throw new ConvexError("Request not found.");
  const split = await ctx.db.get(request.splitId);

  const share = split?.shares.find(
    (s) => s.person.userId === request.participantId,
  );

  if (
    !split ||
    split.asset !== "USDC" ||
    split.state !== "sent" ||
    (currentContract && split.creation?.contract !== NARU_SPLIT.contract) ||
    !split.creation?.hash ||
    !split.organizerAccount ||
    !share?.account ||
    share.units !== request.units ||
    request.amount !== displayAmount(share.units) ||
    split.organizer.userId !== request.organizerId
  )
    throw new ConvexError("Verified reimbursement request unavailable.");

  return {
    me,
    request,
    split,
    intent: {
      account: share.account,
      organizer: split.organizerAccount,
      splitId: split.creation.id,
      units: share.units,
    },
  };
}

async function requirePayer(ctx: QueryCtx, id: Id<"paymentRequests">) {
  const terms = await contractRequestAccess(ctx, id);

  if (terms.me._id !== terms.request.participantId)
    throw new ConvexError(
      "Only the requested friend can authorize this payment.",
    );
  const account = await payment(ctx, terms.me.clerkUserId);

  if (
    account?.state !== "ready" ||
    account.account !== terms.intent.account ||
    !account.credentialId ||
    !account.publicKey
  )
    throw new ConvexError(
      "Activate or restore this request’s payment account first.",
    );

  return terms;
}

export const paymentStatus = query({
  args: { id: v.id("paymentRequests") },
  handler: async (ctx, { id }) => {
    const { request, intent, split } = await contractRequestAccess(
      ctx,
      id,
      false,
    );

    return {
      state: request.state,
      hash: request.hash,
      error: request.settlement?.error,
      intent,
      payable: split.creation?.contract === NARU_SPLIT.contract,
    };
  },
});

export const paymentTerms = query({
  args: { key: v.string(), id: v.id("paymentRequests") },
  handler: async (ctx, { key, id }) => {
    requireServer(key);
    const { me, ...terms } = await contractRequestAccess(ctx, id);

    return { ...terms, isOrganizer: me._id === terms.request.organizerId };
  },
});

export const bindPayment = mutation({
  args: { key: v.string(), id: v.id("paymentRequests"), reviewId: v.string() },
  handler: async (ctx, { key, id, reviewId }) => {
    requireServer(key);
    const { request, intent } = await requirePayer(ctx, id);

    if (request.state !== "outstanding")
      throw new ConvexError(
        "This request is pending, paid, or cancelled. Check its status.",
      );

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "split_pay" ||
      job.account !== intent.account ||
      job.state !== "review" ||
      job.expires <= Date.now()
    )
      throw new ConvexError("Payment review unavailable.");

    if (
      request.settlement?.reviewId &&
      request.settlement.reviewId !== reviewId
    ) {
      const previous = await ctx.db
        .query("sponsorJobs")
        .withIndex("by_intent", (q) => q.eq("id", request.settlement!.reviewId))
        .unique();

      if (previous && previous.state !== "failed") {
        if (previous.state !== "review")
          throw new ConvexError("A payment is pending. Check its status.");
        await ctx.db.patch(previous._id, {
          state: "failed",
          error: "Unsubmitted review replaced. Authorization invalidated.",
        });
      }
    }

    await ctx.db.patch(id, { settlement: { reviewId }, updatedAt: Date.now() });
  },
});

export const claimPayment = mutation({
  args: { key: v.string(), id: v.id("paymentRequests"), reviewId: v.string() },
  handler: async (ctx, { key, id, reviewId }) => {
    requireServer(key);
    const { request, intent, me } = await requirePayer(ctx, id);

    if (request.settlement?.reviewId !== reviewId)
      throw new ConvexError("Payment review changed. Review again.");

    if (request.state === "submitting" || request.state === "paid")
      return false;

    if (request.state !== "outstanding")
      throw new ConvexError("This request can no longer be paid.");

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "split_pay" ||
      job.account !== intent.account ||
      job.state !== "review" ||
      job.expires <= Date.now()
    )
      throw new ConvexError("Payment review expired. Review again.");
    await throttle(ctx, `split-payment:${me._id}`, 10, 3_600_000);
    await ctx.db.patch(id, { state: "submitting", updatedAt: Date.now() });

    return true;
  },
});

export const reportPayment = mutation({
  args: {
    key: v.string(),
    id: v.id("paymentRequests"),
    reviewId: v.string(),
    paidLedger: v.optional(v.number()),
    balances: v.optional(
      v.object({ sender: walletBalances, recipient: walletBalances }),
    ),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);

    const { request, split, intent } = await contractRequestAccess(
      ctx,
      args.id,
    );

    if (request.settlement?.reviewId !== args.reviewId)
      throw new ConvexError("Payment review changed.");

    if (request.state === "paid") return;

    if (request.state !== "submitting")
      throw new ConvexError("Payment was not authorized.");

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", args.reviewId))
      .unique();

    if (!job || job.kind !== "split_pay" || job.account !== intent.account)
      throw new ConvexError("Payment evidence unavailable.");

    if (job.state === "confirmed") {
      if (
        !job.hash ||
        !job.envelope ||
        !job.ledger ||
        args.paidLedger !== job.ledger
      )
        throw new ConvexError("Verified share settlement is required.");
      await ctx.db.patch(request._id, {
        state: "paid",
        hash: job.hash,
        settlement: { reviewId: job.id },
        updatedAt: Date.now(),
      });
      await ctx.db.patch(split._id, {
        shares: split.shares.map((share) => ({
          ...share,
          requestState:
            share.person.userId === request.participantId
              ? ("paid" as const)
              : share.requestState,
        })),
        updatedAt: Date.now(),
      });

      if (args.balances) {
        for (const [profileId, expected, balances] of [
          [request.participantId, intent.account, args.balances.sender],
          [request.organizerId, intent.organizer, args.balances.recipient],
        ] as const) {
          if (balances.account !== expected)
            throw new ConvexError("Payment balances changed account.");
          const profile = (await ctx.db.get(profileId))!;
          const wallet = await payment(ctx, profile.clerkUserId);

          if (wallet?.account === expected)
            await ctx.db.patch(wallet._id, {
              ...balances,
              updatedAt: Date.now(),
            });
        }
      }
    } else if (job.state === "failed") {
      await ctx.db.patch(request._id, {
        state: "outstanding",
        settlement: {
          reviewId: job.id,
          error: job.error ?? "Payment failed. Review again.",
        },
        updatedAt: Date.now(),
      });
    }
  },
});
