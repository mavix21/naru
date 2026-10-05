import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { appendOperationConfirmation } from "./conversations";
import { deliverTransfer } from "./directMessages";
import { assertTransferAmount, parseAmount } from "./money";
import {
  deliver,
  profileFor,
  publicPerson,
  requireFriend,
  socialUser,
  throttle,
} from "./socialShared";
import { requestAccess } from "./splits";
import { swapTerms, transferAsset, walletBalances } from "./validators";

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

export const friendRecipient = query({
  args: { key: v.string(), id: v.id("profiles") },
  handler: async (ctx, { key, id }) => {
    requireServer(key);
    const me = await socialUser(ctx);
    await requireFriend(ctx, me._id, id);
    const profile = (await ctx.db.get(id))!;
    const recipient = await payment(ctx, profile.clerkUserId);

    if (
      recipient?.state !== "ready" ||
      !recipient.account ||
      !recipient.credentialId ||
      !recipient.publicKey
    )
      throw new ConvexError(
        "Your friend needs to activate their Naru payment account first.",
      );

    return {
      userId: profile.clerkUserId,
      account: recipient.account,
      person: await publicPerson(ctx, id),
    };
  },
});

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

async function incomingPending(ctx: QueryCtx) {
  const user = await requireUser(ctx);

  const splits = await ctx.db
    .query("splits")
    .withIndex("by_owner", (q) => q.eq("clerkUserId", user))
    .collect();

  const direct = await ctx.db
    .query("operations")
    .withIndex("by_recipient_state", (q) =>
      q.eq("recipientUserId", user).eq("state", "submitting"),
    )
    .collect();

  const operations = direct.filter(
    (row) => !row.swap && !row.requestId && row.recipientProfileId,
  );

  for (const split of splits) {
    if (split.state !== "sent") continue;

    const requests = await ctx.db
      .query("paymentRequests")
      .withIndex("by_split", (q) => q.eq("splitId", split._id))
      .collect();

    for (const request of requests) {
      if (request.state !== "submitting" || !request.operationId) continue;
      const operation = await ctx.db.get(request.operationId);

      if (
        operation?.state === "submitting" &&
        operation.requestId === request._id
      )
        operations.push(operation);
    }
  }

  return operations;
}

export const pendingIncomingCount = query({
  args: {},
  handler: async (ctx) => (await incomingPending(ctx)).length,
});

export const incomingForReconciliation = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireServer(key);

    return incomingPending(ctx);
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
    recipientProfileId: v.optional(v.id("profiles")),
    recipientUsername: v.optional(v.string()),
    recipient: v.string(),
    account: v.string(),
    token: v.string(),
    amount: v.string(),
    units: v.string(),
    asset: v.optional(transferAsset),
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

    if (!args.recipientProfileId)
      throw new ConvexError("Choose a recipient using a friend mention.");
    const me = await profileFor(ctx, user);
    const recipientProfile = await ctx.db.get(args.recipientProfileId);

    if (!me || recipientProfile?.clerkUserId !== args.recipientUserId)
      throw new ConvexError("Recipient identity changed.");
    await requireFriend(ctx, me._id, args.recipientProfileId);

    const message = await ctx.db
      .query("messages")
      .withIndex("by_message", (q) =>
        q
          .eq("conversationId", conversation._id)
          .eq("messageId", args.messageId),
      )
      .unique();

    if (!message?.mentions?.some((m) => m.userId === args.recipientProfileId))
      throw new ConvexError("Select your recipient using @ in this message.");

    const [sender, recipient] = await Promise.all([
      payment(ctx, user),
      payment(ctx, args.recipientUserId),
    ]);

    if (
      sender?.state !== "ready" ||
      sender.account !== args.account ||
      !sender.credentialId ||
      !sender.publicKey ||
      recipient?.state !== "ready" ||
      recipient.account !== args.recipient ||
      !recipient.credentialId ||
      !recipient.publicKey ||
      sender.account === recipient.account ||
      user === args.recipientUserId
    )
      throw new ConvexError("Both Naru payment accounts must be active.");

    const asset = args.asset ?? "XLM";
    assertTransferAmount({ ...args, asset });
    const { key: _key, ...fields } = args;
    const person = await publicPerson(ctx, args.recipientProfileId);

    return ctx.db.insert("operations", {
      ...fields,
      clerkUserId: user,
      asset,
      recipientName: person.displayName,
      recipientUsername: person.username,
      revision: 1,
      state: "awaiting_approval",
      reviewId: null,
      hash: null,
      error: null,
      updatedAt: Date.now(),
    });
  },
});

export const prepareSwap = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    account: v.string(),
    token: v.string(),
    amount: v.string(),
    units: v.string(),
    swap: swapTerms,
    reviewId: v.string(),
    id: v.optional(v.id("operations")),
    revision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);

    const previous = args.id
      ? await owned(ctx, args.id)
      : await ctx.db
          .query("operations")
          .withIndex("by_turn", (q) =>
            q.eq("clerkUserId", user).eq("messageId", args.messageId),
          )
          .unique();

    if (previous && !args.id) return previous._id;

    if (args.id) {
      if (
        !previous?.swap ||
        previous.revision !== args.revision ||
        previous.state !== "awaiting_approval" ||
        previous.account !== args.account ||
        previous.token !== args.token ||
        previous.swap.targetOut !== args.swap.targetOut ||
        (!previous.swap.targetOut && previous.units !== args.units) ||
        previous.messageId !== args.messageId
      )
        throw new ConvexError(
          "This swap changed. Read its current card before continuing.",
        );
    } else {
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
        .unique();

      if (
        conversation?.activeTurn !== args.messageId ||
        conversation.activeUntil <= Date.now()
      )
        throw new ConvexError("This reply expired. Ask again.");
    }

    const sender = await payment(ctx, user);

    if (sender?.state !== "ready" || sender.account !== args.account)
      throw new ConvexError("Activate your Naru payment account first.");

    const job = await ctx.db
      .query("sponsorJobs")
      .withIndex("by_intent", (q) => q.eq("id", args.reviewId))
      .unique();

    if (
      !job ||
      job.kind !== "swap" ||
      job.account !== args.account ||
      job.state !== "review" ||
      job.expires !== args.swap.expiresAt ||
      args.swap.expiresAt <= Date.now()
    )
      throw new ConvexError("The swap quote expired. Get a new quote.");

    if (previous) {
      await ctx.db.patch(previous._id, {
        amount: args.amount,
        units: args.units,
        swap: args.swap,
        reviewId: args.reviewId,
        revision: previous.revision + 1,
        updatedAt: Date.now(),
      });

      return previous._id;
    }

    return ctx.db.insert("operations", {
      clerkUserId: user,
      messageId: args.messageId,
      recipientUserId: user,
      recipientEmail: "",
      recipientName: "Your account",
      recipient: args.account,
      account: args.account,
      asset: "XLM",
      token: args.token,
      amount: args.amount,
      units: args.units,
      swap: args.swap,
      reviewId: args.reviewId,
      revision: 1,
      state: "awaiting_approval",
      hash: null,
      error: null,
      updatedAt: Date.now(),
    });
  },
});

export const prepareRequest = mutation({
  args: {
    key: v.string(),
    requestId: v.id("paymentRequests"),
    token: v.string(),
  },
  handler: async (ctx, { key, requestId, token }) => {
    requireServer(key);
    const { me, request, split } = await requestAccess(ctx, requestId);

    if (me._id !== request.participantId)
      throw new ConvexError("Only the recipient can pay this request.");

    if (request.operationId) {
      const previous = await ctx.db.get(request.operationId);

      if (
        previous &&
        previous.state !== "failed" &&
        previous.state !== "cancelled"
      )
        return previous._id;
    }

    if (request.state !== "outstanding")
      throw new ConvexError("This request is not outstanding.");
    await requireFriend(ctx, me._id, request.organizerId);
    const organizer = (await ctx.db.get(request.organizerId))!;

    const [sender, recipient] = await Promise.all([
      payment(ctx, me.clerkUserId),
      payment(ctx, organizer.clerkUserId),
    ]);

    if (
      sender?.state !== "ready" ||
      !sender.account ||
      !sender.credentialId ||
      !sender.publicKey
    )
      throw new ConvexError(
        "Activate your existing Naru payment account first.",
      );

    if (
      recipient?.state !== "ready" ||
      recipient.account !== split.organizerAccount ||
      !recipient.account ||
      !recipient.credentialId ||
      !recipient.publicKey
    )
      throw new ConvexError(
        "The organizer’s verified payment account is unavailable or changed.",
      );

    if (split.asset !== "XLM" || split.token !== token)
      throw new ConvexError("Unsupported testnet asset.");
    await throttle(ctx, `request-payment:${me._id}`, 10);
    const person = await publicPerson(ctx, organizer._id);

    const id = await ctx.db.insert("operations", {
      clerkUserId: me.clerkUserId,
      messageId: `request-${requestId}`,
      requestId,
      recipientUserId: organizer.clerkUserId,
      recipientProfileId: organizer._id,
      recipientEmail: "",
      recipientUsername: person.username,
      recipientName: person.displayName,
      account: sender.account,
      recipient: recipient.account,
      asset: split.asset,
      token: split.token,
      amount: request.amount,
      units: request.units,
      revision: 1,
      state: "awaiting_approval",
      reviewId: null,
      hash: null,
      error: null,
      updatedAt: Date.now(),
    });

    await ctx.db.patch(requestId, { operationId: id, updatedAt: Date.now() });
    await deliver(
      ctx,
      me.clerkUserId,
      `payment-review:${id}`,
      {
        kind: "payment_review",
        actor: person,
        requestId,
        splitId: split._id,
      },
      false,
    );

    return id;
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
      v.object({ kind: v.literal("retry") }),
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
        receivedUnits: v.optional(v.string()),
        balances: v.optional(
          v.object({ sender: walletBalances, recipient: walletBalances }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const row = await ctx.db.get(args.id);
    const user = await requireUser(ctx);

    if (!row) throw new ConvexError("Operation not found.");

    if (row.clerkUserId !== user) {
      const request = row.requestId ? await ctx.db.get(row.requestId) : null;
      const split = request ? await ctx.db.get(request.splitId) : null;

      // An organizer's server may reconcile evidence, never review or authorize
      // another person's operation. All reports still require the server key.
      const incomingDirect =
        !row.swap &&
        !row.requestId &&
        row.recipientProfileId &&
        row.recipientUserId === user;

      if (
        args.action.kind !== "report" ||
        (!incomingDirect &&
          (!request ||
            request.operationId !== row._id ||
            split?.clerkUserId !== user))
      )
        throw new ConvexError("Operation not found.");
    }

    const action = args.action;
    const request = row.requestId ? await ctx.db.get(row.requestId) : null;

    if (row.swap && (action.kind === "edit" || action.kind === "bind"))
      throw new ConvexError(
        "Get a fresh swap quote instead of changing reviewed terms.",
      );

    if (row.requestId && (!request || request.operationId !== row._id))
      throw new ConvexError(
        "This request has a different payment attempt. Read its current card.",
      );

    if (request && action.kind === "edit")
      throw new ConvexError(
        "Sent request amounts are immutable. Pay the full request.",
      );

    if (request && (action.kind === "bind" || action.kind === "submit")) {
      if (request.state !== "outstanding")
        throw new ConvexError("This request is no longer payable.");
      await requireFriend(ctx, request.organizerId, request.participantId);
      const split = await ctx.db.get(request.splitId);

      if (
        row.units !== request.units ||
        row.amount !== request.amount ||
        row.recipient !== split?.organizerAccount ||
        row.token !== split.token
      )
        throw new ConvexError("Payment does not match this request.");
    }

    if (row.revision !== args.revision)
      throw new ConvexError(
        "This review changed. Read the updated card before confirming.",
      );

    // Recheck friendship and both linked accounts atomically with the claim.
    // Old XLM records without a social profile remain readable/reconcilable.
    if (
      !row.swap &&
      (action.kind === "bind" ||
        action.kind === "submit" ||
        action.kind === "retry")
    ) {
      assertTransferAmount(row);

      if (row.asset === "USDC" && (!row.recipientProfileId || row.requestId))
        throw new ConvexError("USDC transfers require an accepted friend.");

      if (row.recipientProfileId) {
        const me = await socialUser(ctx);
        await requireFriend(ctx, me._id, row.recipientProfileId);
        const profile = await ctx.db.get(row.recipientProfileId);

        const [sender, recipient] = await Promise.all([
          payment(ctx, row.clerkUserId),
          payment(ctx, row.recipientUserId),
        ]);

        if (
          profile?.clerkUserId !== row.recipientUserId ||
          sender?.state !== "ready" ||
          sender.account !== row.account ||
          recipient?.state !== "ready" ||
          recipient.account !== row.recipient ||
          !recipient.credentialId ||
          !recipient.publicKey ||
          !sender.credentialId ||
          !sender.publicKey
        )
          throw new ConvexError(
            "The verified payment accounts changed. Review a new transfer.",
          );
      }

      if (action.kind !== "retry") {
        const job = await ctx.db
          .query("sponsorJobs")
          .withIndex("by_intent", (q) => q.eq("id", action.reviewId))
          .unique();

        if (
          !job ||
          job.kind !== "transfer" ||
          job.account !== row.account ||
          job.state !== "review" ||
          job.expires <= Date.now()
        )
          throw new ConvexError("Transfer review expired. Review again.");
      }
    }

    if (action.kind === "retry") {
      if (row.swap || row.requestId || row.state !== "failed" || !row.reviewId)
        throw new ConvexError(
          "Only a definitively failed direct transfer can be reviewed again.",
        );

      const evidence = await ctx.db
        .query("sponsorJobs")
        .withIndex("by_intent", (q) => q.eq("id", row.reviewId!))
        .unique();

      if (evidence?.state !== "failed")
        throw new ConvexError(
          "Confirmation is unknown. Check status before retrying.",
        );
      await ctx.db.patch(row._id, {
        state: "awaiting_approval",
        revision: row.revision + 1,
        reviewId: null,
        hash: null,
        error: null,
        updatedAt: Date.now(),
      });

      return;
    }

    if (action.kind === "report") {
      if (row.reviewId !== action.reviewId || row.state !== "submitting")
        return;

      if (action.state === "confirmed") {
        if (!action.hash || !/^[a-f0-9]{64}$/.test(action.hash))
          throw new ConvexError("Confirmed transaction evidence is required.");

        if (row.swap) {
          const evidence = await ctx.db
            .query("sponsorJobs")
            .withIndex("by_intent", (q) => q.eq("id", action.reviewId))
            .unique();

          if (
            evidence?.kind !== "swap" ||
            evidence.account !== row.account ||
            evidence.state !== "confirmed" ||
            evidence.hash !== action.hash ||
            !evidence.ledger ||
            !evidence.envelope ||
            !evidence.result ||
            !action.receivedUnits ||
            !/^[1-9]\d{0,38}$/.test(action.receivedUnits) ||
            BigInt(action.receivedUnits) < BigInt(row.swap.minimumOut)
          )
            throw new ConvexError("Confirmed swap evidence is required.");
        } else {
          const evidence = await ctx.db
            .query("sponsorJobs")
            .withIndex("by_intent", (q) => q.eq("id", action.reviewId))
            .unique();

          if (
            evidence?.kind !== "transfer" ||
            evidence.account !== row.account ||
            evidence.state !== "confirmed" ||
            evidence.hash !== action.hash ||
            !evidence.ledger ||
            !evidence.envelope
          )
            throw new ConvexError("Confirmed transfer evidence is required.");
        }

        const used = await ctx.db
          .query("operations")
          .withIndex("by_hash", (q) => q.eq("hash", action.hash))
          .collect();

        if (used.some((other) => other._id !== row._id))
          throw new ConvexError(
            "This transaction already belongs to another operation.",
          );
      }

      if (!row.swap && action.state === "failed") {
        const evidence = await ctx.db
          .query("sponsorJobs")
          .withIndex("by_intent", (q) => q.eq("id", action.reviewId))
          .unique();

        if (evidence?.state !== "failed")
          throw new ConvexError(
            "A pending transfer cannot be reported as failed.",
          );
      }

      if (!row.swap && action.state === "confirmed" && action.balances) {
        for (const [user, expected, balances] of [
          [row.clerkUserId, row.account, action.balances.sender],
          [row.recipientUserId, row.recipient, action.balances.recipient],
        ] as const) {
          if (balances.account !== expected)
            throw new ConvexError("Balance account mismatch.");
          const wallet = await payment(ctx, user);

          if (wallet?.account === expected)
            await ctx.db.patch(wallet._id, {
              ...balances,
              updatedAt: Date.now(),
            });
        }
      }

      if (request) {
        if (request.state !== "submitting")
          throw new ConvexError("Request settlement is not pending.");
        await ctx.db.patch(request._id, {
          state:
            action.state === "confirmed"
              ? "paid"
              : action.state === "failed"
                ? "outstanding"
                : "submitting",
          hash: action.state === "confirmed" ? action.hash! : undefined,
          updatedAt: Date.now(),
        });

        if (action.state === "confirmed") {
          const organizer = (await ctx.db.get(request.organizerId))!;
          const participant = (await ctx.db.get(request.participantId))!;
          await deliver(
            ctx,
            organizer.clerkUserId,
            `request:${request._id}:paid`,
            {
              kind: "paid",
              actor: await publicPerson(ctx, participant._id),
              requestId: request._id,
              splitId: request.splitId,
            },
          );
          await deliver(
            ctx,
            participant.clerkUserId,
            `request:${request._id}:paid`,
            {
              kind: "paid",
              actor: await publicPerson(ctx, organizer._id),
              requestId: request._id,
              splitId: request.splitId,
            },
          );
        }
      }

      await ctx.db.patch(row._id, {
        state: action.state,
        hash: action.hash,
        error: action.error,
        receivedUnits:
          row.swap && action.state === "confirmed"
            ? action.receivedUnits
            : row.receivedUnits,
        updatedAt: Date.now(),
      });

      if (
        !row.swap &&
        !row.requestId &&
        row.recipientProfileId &&
        action.state === "confirmed"
      )
        await deliverTransfer(ctx, (await ctx.db.get(row._id))!);

      if (
        action.state === "confirmed" &&
        (row.swap || (!row.requestId && row.recipientProfileId))
      )
        await appendOperationConfirmation(ctx, row);

      return;
    }

    if (row.state !== "awaiting_approval")
      throw new ConvexError(
        "This operation is no longer awaiting approval. Check its status.",
      );

    if (action.kind === "submit") {
      if (row.swap && row.swap.deadline * 1000 <= Date.now())
        throw new ConvexError("Quote expired. Get a new quote and review it.");

      if (row.reviewId !== action.reviewId)
        throw new ConvexError(
          "Authorization does not match the current review.",
        );
      await ctx.db.patch(row._id, {
        state: "submitting",
        updatedAt: Date.now(),
      });

      if (request)
        await ctx.db.patch(request._id, {
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
      const parsed = parseAmount(action.amount, row.asset);

      if (parsed.units !== action.units || parsed.amount !== action.amount)
        throw new ConvexError("Invalid asset amount.");
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
