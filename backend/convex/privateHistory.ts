import { createThread, saveMessages } from "@convex-dev/agent";
import { convertToModelMessages, validateUIMessages } from "ai";
import { ConvexError } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import { components } from "./_generated/api";

// One conversation migrates atomically, including its component writes. Keeping
// the existing row IDs preserves payment references, mentions, events and order.
// A saved thread ID is the commit marker, so retries cannot duplicate history.
export async function migratePrivateHistory(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
) {
  if (conversation.agentThreadId) return 0;

  const rows = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("asc")
    .take(501);

  if (rows.length > 500)
    throw new ConvexError(
      "This legacy conversation needs a larger migration window.",
    );

  const threadId = await createThread(ctx, components.agent, {
    userId: conversation.clerkUserId,
  });

  for (const row of rows) {
    if (!row.content) {
      if (row.agentMessageIds?.length)
        throw new ConvexError(
          "Agent messages exist without their private thread.",
        );
      await ctx.db.patch(row._id, { agentMessageIds: [] });
      continue;
    }

    const [message] = await validateUIMessages({
      messages: [JSON.parse(row.content)],
    });

    if (message.id !== row.messageId || message.role !== row.role)
      throw new ConvexError(
        "Legacy message identity does not match its saved record.",
      );

    const modelMessages = await convertToModelMessages([message], {
      ignoreIncompleteToolCalls: true,
    });

    const saved = modelMessages.length
      ? await saveMessages(ctx, components.agent, {
          threadId,
          userId: conversation.clerkUserId,
          order: row.sequence,
          messages: modelMessages,
          agentName: "Naru",
        })
      : { messages: [] };

    await ctx.db.patch(row._id, {
      agentMessageIds: saved.messages.map((m) => m._id),
      content: undefined,
    });
  }

  await ctx.db.patch(conversation._id, { agentThreadId: threadId });

  return rows.length;
}
