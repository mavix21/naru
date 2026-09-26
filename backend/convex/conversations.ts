import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer, requireUser } from "./access";

function find(ctx: QueryCtx, user: string) {
  return ctx.db
    .query("conversations")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();
}

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

    const messages = rows.slice(0, 40).reverse();

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

export const begin = mutation({
  args: { key: v.string(), messageId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);

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
    await ctx.db.insert("messages", {
      conversationId: conversation._id,
      messageId: args.messageId,
      sequence: conversation.sequence + 1,
      role: "user",
      content: JSON.stringify({
        id: args.messageId,
        role: "user",
        parts: [{ type: "text", text: args.text.trim() }],
      }),
    });
    await ctx.db.patch(conversation._id, {
      sequence: conversation.sequence + 2,
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
    const conversation = await find(ctx, await requireUser(ctx));

    if (!conversation || conversation.activeTurn !== args.messageId) return;

    if (args.content) {
      if (args.content.length > 200_000)
        throw new ConvexError("Reply is too large.");

      if (!args.responseId) throw new ConvexError("Missing response ID.");
      await ctx.db.insert("messages", {
        conversationId: conversation._id,
        messageId: args.responseId,
        sequence: conversation.sequence,
        role: "assistant",
        content: args.content,
      });
    }

    await ctx.db.patch(conversation._id, {
      activeTurn: null,
      activeUntil: 0,
      error: args.error?.slice(0, 300) ?? null,
    });
  },
});
