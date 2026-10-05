import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import { mutation, query } from "./_generated/server";
import { requireUser } from "./access";
import {
  profileFor,
  publicPerson,
  relationship,
  requireFriend,
  socialUser,
  throttle,
} from "./socialShared";

function memberFor(
  ctx: QueryCtx,
  conversationId: Id<"directConversations">,
  profileId: Id<"profiles">,
) {
  return ctx.db
    .query("directMembers")
    .withIndex("by_conversation_participant", (q) =>
      q
        .eq("conversationId", conversationId)
        .eq("participant.profileId", profileId),
    )
    .unique();
}

async function requireMember(
  ctx: QueryCtx,
  conversationId: Id<"directConversations">,
) {
  const profile = await profileFor(ctx, await requireUser(ctx));

  if (!profile) throw new ConvexError("Conversation unavailable.");
  const member = await memberFor(ctx, conversationId, profile._id);

  if (!member) throw new ConvexError("Conversation unavailable.");
  const conversation = await ctx.db.get(conversationId);

  if (
    !conversation ||
    (conversation.low !== profile._id && conversation.high !== profile._id)
  )
    throw new ConvexError("Conversation unavailable.");

  const friendId =
    conversation.low === profile._id ? conversation.high : conversation.low;

  return { profile, member, conversation, friendId };
}

export const start = mutation({
  args: { friendId: v.id("profiles") },
  handler: async (ctx, { friendId }) => {
    const me = await socialUser(ctx);
    const existing = await pairConversation(ctx, me._id, friendId);

    if (existing) {
      await requireMember(ctx, existing._id);

      return existing._id;
    }

    await requireFriend(ctx, me._id, friendId);
    await throttle(ctx, `dm-start:${me._id}`, 20);

    return (await ensurePair(ctx, me._id, friendId))._id;
  },
});

function pairConversation(ctx: QueryCtx, a: Id<"profiles">, b: Id<"profiles">) {
  const [low, high] = [a, b].sort();

  return ctx.db
    .query("directConversations")
    .withIndex("by_pair", (q) => q.eq("low", low).eq("high", high))
    .unique();
}

async function ensurePair(
  ctx: MutationCtx,
  a: Id<"profiles">,
  b: Id<"profiles">,
) {
  const existing = await pairConversation(ctx, a, b);

  if (existing) return existing;
  const [low, high] = [a, b].sort();
  const updatedAt = Date.now();

  // The empty-range read above serializes concurrent creation from both sides.
  const id = await ctx.db.insert("directConversations", {
    kind: "direct",
    low,
    high,
    sequence: 0,
    updatedAt,
  });

  for (const profileId of [low, high])
    await ctx.db.insert("directMembers", {
      conversationId: id,
      participant: { kind: "human", profileId },
      receivedCount: 0,
      readCount: 0,
      readSequence: 0,
      updatedAt,
    });

  return (await ctx.db.get(id))!;
}

// Internal delivery only: callers must have verified publication. No agent runs,
// human-authored text, private history, or notification-bell entry is generated.
export async function deliverSplitRequest(
  ctx: MutationCtx,
  request: Doc<"paymentRequests">,
  split: Doc<"splits">,
) {
  if (
    split.asset !== "USDC" ||
    !split.creation?.hash ||
    (split.state !== "published" && split.state !== "sent") ||
    request.splitId !== split._id ||
    request.organizerId !== split.organizer.userId ||
    request.participantId === request.organizerId ||
    !split.participantIds.includes(request.participantId)
  )
    throw new ConvexError("Request publication is not verified.");

  const existing = await ctx.db
    .query("directMessages")
    .withIndex("by_request", (q) => q.eq("requestId", request._id))
    .unique();

  if (existing) return existing._id;

  const conversation = await ensurePair(
    ctx,
    request.organizerId,
    request.participantId,
  );

  const [sender, recipient] = await Promise.all([
    memberFor(ctx, conversation._id, request.organizerId),
    memberFor(ctx, conversation._id, request.participantId),
  ]);

  if (!sender || !recipient) throw new ConvexError("Conversation unavailable.");
  const sequence = conversation.sequence + 1;
  const updatedAt = Date.now();

  const id = await ctx.db.insert("directMessages", {
    conversationId: conversation._id,
    author: { kind: "naru_request", profileId: request.organizerId },
    recipientId: request.participantId,
    recipientOrdinal: recipient.receivedCount + 1,
    clientId: `split-request:${request._id}`,
    kind: "split_request",
    text: "",
    requestId: request._id,
    sequence,
  });

  await ctx.db.patch(conversation._id, {
    sequence,
    updatedAt,
    preview: `Naru request · ${request.amount} USDC · ${split.title}`,
    lastAuthorId: request.organizerId,
  });
  await ctx.db.patch(sender._id, { updatedAt });
  await ctx.db.patch(recipient._id, {
    updatedAt,
    receivedCount: recipient.receivedCount + 1,
  });

  return id;
}

// Called only after reconciliation verifies the on-chain transfer. The receipt
// and unread count commit with the operation, without touching private Naru chat.
export async function deliverTransfer(
  ctx: MutationCtx,
  operation: Doc<"operations">,
) {
  if (
    operation.state !== "confirmed" ||
    !operation.hash ||
    !operation.recipientProfileId ||
    operation.swap ||
    operation.requestId
  )
    throw new ConvexError("Transfer confirmation is not verified.");

  const existing = await ctx.db
    .query("directMessages")
    .withIndex("by_operation", (q) => q.eq("operationId", operation._id))
    .unique();

  if (existing) return existing._id;

  const senderProfile = await profileFor(ctx, operation.clerkUserId);
  const recipientProfile = await ctx.db.get(operation.recipientProfileId);

  if (
    !senderProfile ||
    recipientProfile?.clerkUserId !== operation.recipientUserId ||
    senderProfile._id === recipientProfile._id
  )
    throw new ConvexError("Transfer identities are unavailable.");

  const conversation = await ensurePair(
    ctx,
    senderProfile._id,
    recipientProfile._id,
  );

  const [sender, recipient] = await Promise.all([
    memberFor(ctx, conversation._id, senderProfile._id),
    memberFor(ctx, conversation._id, recipientProfile._id),
  ]);

  if (!sender || !recipient) throw new ConvexError("Conversation unavailable.");
  const sequence = conversation.sequence + 1;
  const updatedAt = Date.now();

  const id = await ctx.db.insert("directMessages", {
    conversationId: conversation._id,
    author: { kind: "naru_transfer", profileId: senderProfile._id },
    recipientId: recipientProfile._id,
    recipientOrdinal: recipient.receivedCount + 1,
    clientId: `transfer:${operation._id}`,
    kind: "transfer",
    text: "",
    operationId: operation._id,
    transfer: {
      amount: operation.amount,
      asset: operation.asset,
      hash: operation.hash,
    },
    sequence,
  });

  await ctx.db.patch(conversation._id, {
    sequence,
    updatedAt,
    preview: `Payment · ${operation.amount} ${operation.asset} · confirmed`,
    lastAuthorId: senderProfile._id,
  });
  await ctx.db.patch(sender._id, { updatedAt });
  await ctx.db.patch(recipient._id, {
    updatedAt,
    receivedCount: recipient.receivedCount + 1,
  });

  return id;
}

export const requestCard = query({
  args: { id: v.id("paymentRequests") },
  handler: async (ctx, { id }) => {
    const request = await ctx.db.get(id);

    if (!request?.directMessageId)
      throw new ConvexError("Request unavailable.");
    const message = await ctx.db.get(request.directMessageId);

    if (
      !message ||
      message.requestId !== id ||
      message.kind !== "split_request"
    )
      throw new ConvexError("Request unavailable.");

    const { profile, conversation } = await requireMember(
      ctx,
      message.conversationId,
    );

    if (
      (profile._id !== request.organizerId &&
        profile._id !== request.participantId) ||
      ![conversation.low, conversation.high].includes(request.organizerId) ||
      ![conversation.low, conversation.high].includes(request.participantId)
    )
      throw new ConvexError("Request unavailable.");
    const split = await ctx.db.get(request.splitId);

    if (
      !split ||
      split.asset !== "USDC" ||
      split.state !== "sent" ||
      !split.creation?.hash
    )
      throw new ConvexError("Request unavailable.");

    // Deliberately project only this request, never the split's other participants.
    return {
      description: split.title,
      amount: request.amount,
      asset: split.asset,
      organizer: split.organizer,
      state: request.state,
      creationHash: split.creation.hash,
    };
  },
});

export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const me = await profileFor(ctx, await requireUser(ctx));

    if (!me) return { me: null, conversations: [] };

    const memberships = await ctx.db
      .query("directMembers")
      .withIndex("by_participant", (q) => q.eq("participant.profileId", me._id))
      .order("desc")
      .collect();

    const conversations = await Promise.all(
      memberships.map(async (member) => {
        const { conversation, friendId } = await requireMember(
          ctx,
          member.conversationId,
        );

        return {
          id: conversation._id,
          person: await publicPerson(ctx, friendId),
          preview: conversation.preview,
          fromMe: conversation.lastAuthorId === me._id,
          updatedAt: conversation.updatedAt,
          unread: member.receivedCount - member.readCount,
        };
      }),
    );

    return { me: me._id, conversations };
  },
});

export const detail = query({
  args: { conversationId: v.id("directConversations") },
  handler: async (ctx, { conversationId }) => {
    const { profile, conversation, member, friendId } = await requireMember(
      ctx,
      conversationId,
    );

    return {
      id: conversation._id,
      me: profile._id,
      person: await publicPerson(ctx, friendId),
      canSend:
        (await relationship(ctx, profile._id, friendId))?.state === "accepted",
      sequence: conversation.sequence,
      readSequence: member.readSequence,
      unread: member.receivedCount - member.readCount,
    };
  },
});

export const history = query({
  args: {
    conversationId: v.id("directConversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    await requireMember(ctx, conversationId);

    return ctx.db
      .query("directMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(50, Math.max(1, paginationOpts.numItems)),
      });
  },
});

export const send = mutation({
  args: {
    conversationId: v.id("directConversations"),
    clientId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { conversationId, clientId, text }) => {
    const { profile, member, conversation, friendId } = await requireMember(
      ctx,
      conversationId,
    );

    if (!/^[\w-]{1,100}$/.test(clientId) || !text.trim() || text.length > 4000)
      throw new ConvexError("Send a message of 1–4,000 characters.");

    const existing = await ctx.db
      .query("directMessages")
      .withIndex("by_retry", (q) =>
        q
          .eq("conversationId", conversationId)
          .eq("author.profileId", profile._id)
          .eq("clientId", clientId),
      )
      .unique();

    // An acknowledged retry is not a new send, even after friendship removal.
    if (existing) {
      if (
        existing.kind !== "text" ||
        existing.author.kind !== "human" ||
        existing.text !== text
      )
        throw new ConvexError("This retry belongs to a different message.");

      return existing._id;
    }

    await requireFriend(ctx, profile._id, friendId);
    await throttle(ctx, `dm-send:${profile._id}`, 30);
    const recipient = await memberFor(ctx, conversationId, friendId);

    if (!recipient) throw new ConvexError("Conversation unavailable.");
    const sequence = conversation.sequence + 1;
    const updatedAt = Date.now();

    const id = await ctx.db.insert("directMessages", {
      conversationId,
      clientId,
      text,
      kind: "text",
      sequence,
      author: { kind: "human", profileId: profile._id },
      recipientId: friendId,
      recipientOrdinal: recipient.receivedCount + 1,
    });

    await ctx.db.patch(conversationId, {
      sequence,
      updatedAt,
      preview: text.slice(0, 160),
      lastAuthorId: profile._id,
    });
    await ctx.db.patch(member._id, { updatedAt });
    await ctx.db.patch(recipient._id, {
      updatedAt,
      receivedCount: recipient.receivedCount + 1,
    });

    return id;
  },
});

export const markRead = mutation({
  args: {
    conversationId: v.id("directConversations"),
    throughSequence: v.number(),
  },
  handler: async (ctx, { conversationId, throughSequence }) => {
    const { profile, member, conversation } = await requireMember(
      ctx,
      conversationId,
    );

    if (
      !Number.isSafeInteger(throughSequence) ||
      throughSequence < 0 ||
      throughSequence > conversation.sequence
    )
      throw new ConvexError("Invalid read position.");

    if (throughSequence <= member.readSequence) return;

    // Only acknowledge the rendered snapshot, not messages arriving during this mutation.
    // Ordinals make partial acknowledgements constant-time even for long histories.
    const lastIncoming = await ctx.db
      .query("directMessages")
      .withIndex("by_recipient", (q) =>
        q
          .eq("conversationId", conversationId)
          .eq("recipientId", profile._id)
          .lte("sequence", throughSequence),
      )
      .order("desc")
      .first();

    await ctx.db.patch(member._id, {
      readSequence: throughSequence,
      readCount: Math.max(
        member.readCount,
        lastIncoming?.recipientOrdinal ?? 0,
      ),
    });
  },
});
