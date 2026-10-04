import {
  createThread,
  fetchContextMessages,
  saveMessage,
  saveMessages,
  toUIMessages,
} from "@convex-dev/agent";
import { convertToModelMessages, validateUIMessages, type UIMessage } from "ai";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

import { components } from "./_generated/api";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { displayAmount } from "./money";
import { validateMentions } from "./socialShared";
import { mentionValidator } from "./validators";

function find(ctx: QueryCtx, user: string) {
  return ctx.db
    .query("conversations")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();
}

// Called in the same transaction that records a verified swap confirmation.
// Reuse the balance tool's saved-message format so the existing card renders
// immediately and the completion remains in the companion's conversation.
export async function appendSwapConfirmation(
  ctx: MutationCtx,
  operation: Doc<"operations">,
) {
  const conversation = await find(ctx, operation.clerkUserId);

  if (!conversation?.agentThreadId)
    throw new ConvexError("Saved agent thread not found.");
  const messageId = `swap-confirmed-${operation._id}`;

  const existing = await ctx.db
    .query("messages")
    .withIndex("by_message", (q) =>
      q.eq("conversationId", conversation._id).eq("messageId", messageId),
    )
    .unique();

  if (existing) return;

  // Reconciliation refreshes both assets before reporting confirmation.
  const wallet = await ctx.db
    .query("payments")
    .withIndex("by_clerk_user", (q) =>
      q.eq("clerkUserId", operation.clerkUserId),
    )
    .unique();

  if (wallet?.state !== "ready" || wallet.account !== operation.account)
    throw new ConvexError("The swap's wallet balance is unavailable.");
  const toolCallId = `swap-balance-${operation._id}`;
  const sequence = conversation.sequence + 1;

  const saved = await saveMessages(ctx, components.agent, {
    threadId: conversation.agentThreadId,
    userId: operation.clerkUserId,
    agentName: "Naru",
    order: sequence,
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Done — your swap is complete." },
          { type: "tool-call", toolCallId, toolName: "readBalance", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "readBalance",
            output: {
              type: "json",
              value: {
                active: true,
                address: wallet.account,
                amount:
                  wallet.balance === null
                    ? null
                    : displayAmount(wallet.balance),
                balanceError: wallet.balanceError,
                asset: "XLM",
                usdcAmount:
                  wallet.usdcBalance == null
                    ? null
                    : displayAmount(wallet.usdcBalance),
                usdcError: wallet.usdcBalanceError ?? null,
                network: "Stellar testnet",
                observedAt: new Date(wallet.updatedAt).toISOString(),
              },
            },
          },
        ],
      },
    ],
  });

  await ctx.db.insert("messages", {
    conversationId: conversation._id,
    messageId,
    sequence,
    role: "assistant",
    agentMessageIds: saved.messages.map((message) => message._id),
  });
  await ctx.db.patch(conversation._id, { sequence });
}

async function readMessages(ctx: QueryCtx, rows: Doc<"messages">[]) {
  const messageIds = rows.flatMap((row) => row.agentMessageIds);

  const docs = messageIds.length
    ? await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds,
      })
    : [];

  const byId = new Map(
    docs.flatMap((doc) => (doc ? [[doc._id, doc] as const] : [])),
  );

  return rows.map((row) => {
    const saved = row.agentMessageIds.map((id) => {
      const doc = byId.get(id);

      if (!doc)
        throw new ConvexError("A saved conversation message is unavailable.");

      return doc;
    });

    const message: UIMessage = {
      id: row.messageId,
      role: row.role,
      parts: toUIMessages(saved).flatMap((item) => item.parts),
    };

    return { ...row, message };
  });
}

export const event = query({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const conversation = await find(ctx, await requireUser(ctx));

    if (!conversation) return null;

    const message = await ctx.db
      .query("messages")
      .withIndex("by_message", (q) =>
        q.eq("conversationId", conversation._id).eq("messageId", messageId),
      )
      .unique();

    return message?.event ?? null;
  },
});

// A private, reactive snapshot. Never shared-cache account or conversation data.
export const current = query({
  args: { before: v.optional(v.number()) },
  handler: async (ctx, { before }) => {
    const user = await requireUser(ctx);
    const conversation = await find(ctx, user);

    if (!conversation)
      return {
        conversation: null,
        messages: [],
        operations: [],
        hasMore: false,
      };

    const rows = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q
          .eq("conversationId", conversation._id)
          .lt("sequence", before ?? Number.MAX_SAFE_INTEGER),
      )
      .order("desc")
      .take(41);

    const messages = await readMessages(ctx, rows.slice(0, 40).reverse());

    const operations = (
      await Promise.all(
        messages
          .filter((m) => m.role === "user")
          .map((m) =>
            ctx.db
              .query("operations")
              .withIndex("by_turn", (q) =>
                q.eq("clerkUserId", user).eq("messageId", m.messageId),
              )
              .collect(),
          ),
      )
    ).flat();

    return { conversation, messages, operations, hasMore: rows.length > 40 };
  },
});

// Only the authenticated app server reads model context. The thread and prompt
// are resolved from owned records, never from caller-supplied component IDs.
export const context = query({
  args: { key: v.string(), messageId: v.string() },
  handler: async (ctx, { key, messageId }) => {
    requireServer(key);
    const user = await requireUser(ctx);
    const conversation = await find(ctx, user);

    if (!conversation?.agentThreadId || conversation.activeTurn !== messageId)
      throw new ConvexError("This conversation turn is no longer active.");

    const prompt = await ctx.db
      .query("messages")
      .withIndex("by_message", (q) =>
        q.eq("conversationId", conversation._id).eq("messageId", messageId),
      )
      .unique();

    const promptMessageId = prompt?.agentMessageIds?.[0];

    if (!promptMessageId) throw new ConvexError("Saved prompt not found.");

    const messages = await fetchContextMessages(ctx, components.agent, {
      userId: user,
      threadId: conversation.agentThreadId,
      targetMessageId: promptMessageId,
      contextOptions: { recentMessages: 40 },
    });

    // Live financial records are authoritative. Keep conversational text, but
    // don't reuse historical balances, quotes, tool calls, or social deliveries.
    return messages.flatMap((doc) => {
      const role = doc.message?.role;

      return doc.text && (role === "user" || role === "assistant")
        ? [{ role, content: doc.text }]
        : [];
    });
  },
});

export const begin = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    text: v.string(),
    mentions: v.optional(v.array(mentionValidator)),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);
    await validateMentions(ctx, user, args.text, args.mentions ?? []);

    if (
      !/^[\w-]{1,100}$/.test(args.messageId) ||
      !args.text.trim() ||
      args.text.length > 4000
    )
      throw new ConvexError("Please send a message of 1–4,000 characters.");
    let conversation = await find(ctx, user);

    if (!conversation) {
      const id = await ctx.db.insert("conversations", {
        clerkUserId: user,
        sequence: 0,
        activeTurn: null,
        activeUntil: 0,
        error: null,
      });

      conversation = (await ctx.db.get(id))!;
    }

    const existing = await ctx.db
      .query("messages")
      .withIndex("by_message", (q) =>
        q
          .eq("conversationId", conversation._id)
          .eq("messageId", args.messageId),
      )
      .unique();

    if (existing)
      throw new ConvexError(
        "This message is already saved. Reload to recover the reply and any prepared transfer.",
      );

    if (conversation.activeTurn && conversation.activeUntil > Date.now())
      throw new ConvexError(
        "Your companion is still replying. Please wait a moment.",
      );

    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(20);

    if (
      recent.filter(
        (m) => m.role === "user" && m._creationTime > Date.now() - 60_000,
      ).length >= 8
    )
      throw new ConvexError("A little pause, please. Try again in a minute.");

    const threadId =
      conversation.agentThreadId ??
      (await createThread(ctx, components.agent, { userId: user }));

    const prompt = await saveMessage(ctx, components.agent, {
      threadId,
      userId: user,
      order: conversation.sequence + 1,
      prompt: args.text,
    });

    await ctx.db.insert("messages", {
      conversationId: conversation._id,
      messageId: args.messageId,
      sequence: conversation.sequence + 1,
      role: "user",
      mentions: args.mentions ?? [],
      agentMessageIds: [prompt.messageId],
    });
    await ctx.db.patch(conversation._id, {
      agentThreadId: threadId,
      sequence: conversation.sequence + 2,
      replySequence: conversation.sequence + 2,
      activeTurn: args.messageId,
      activeUntil: Date.now() + 150_000,
      error: null,
    });

    return conversation._id;
  },
});

export const finish = mutation({
  args: {
    key: v.string(),
    messageId: v.string(),
    responseId: v.optional(v.string()),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);
    const conversation = await find(ctx, user);

    if (!conversation || conversation.activeTurn !== args.messageId) return;

    if (args.content) {
      if (args.content.length > 200_000)
        throw new ConvexError("Reply is too large.");

      if (!args.responseId) throw new ConvexError("Missing response ID.");

      const [response] = await validateUIMessages({
        messages: [JSON.parse(args.content)],
      });

      if (response.role !== "assistant" || response.id !== args.responseId)
        throw new ConvexError("Invalid companion reply.");

      const prompt = await ctx.db
        .query("messages")
        .withIndex("by_message", (q) =>
          q
            .eq("conversationId", conversation._id)
            .eq("messageId", args.messageId),
        )
        .unique();

      const promptMessageId = prompt?.agentMessageIds?.[0];

      if (!conversation.agentThreadId || !promptMessageId)
        throw new ConvexError("Saved agent thread not found.");

      const modelMessages = await convertToModelMessages([response], {
        ignoreIncompleteToolCalls: true,
      });

      const saved = modelMessages.length
        ? await saveMessages(ctx, components.agent, {
            threadId: conversation.agentThreadId,
            userId: user,
            promptMessageId,
            messages: modelMessages,
            agentName: "Naru",
          })
        : { messages: [] };

      await ctx.db.insert("messages", {
        conversationId: conversation._id,
        messageId: args.responseId,
        sequence: conversation.replySequence ?? conversation.sequence,
        role: "assistant",
        agentMessageIds: saved.messages.map((message) => message._id),
      });
    }

    await ctx.db.patch(conversation._id, {
      activeTurn: null,
      activeUntil: 0,
      error: args.error?.slice(0, 300) ?? null,
    });
  },
});
