import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { deliver, publicPerson, requireFriend, throttle } from "./socialShared";
import { requestAccess } from "./splits";

function clean(text: string) {
  const value = text.trim();

  if (!value || value.length > 500 || /[\p{Cc}\p{Cf}]/u.test(value))
    throw new ConvexError("Use a short reply of 1–500 characters on one line.");

  return value;
}

async function prepareReply(
  ctx: MutationCtx,
  args: { requestId: Id<"paymentRequests">; messageId: string; text: string },
) {
  const { me, request } = await requestAccess(ctx, args.requestId);
  await requireFriend(ctx, request.organizerId, request.participantId);

  if (!/^[\w-]{1,100}$/.test(args.messageId))
    throw new ConvexError("Invalid reply reference.");

  const previous = await ctx.db
    .query("replies")
    .withIndex("by_turn", (q) =>
      q.eq("clerkUserId", me.clerkUserId).eq("messageId", args.messageId),
    )
    .unique();

  if (previous) return previous._id;
  await throttle(ctx, `reply-preview:${me._id}`, 12);

  const id = await ctx.db.insert("replies", {
    clerkUserId: me.clerkUserId,
    messageId: args.messageId,
    requestId: request._id,
    text: clean(args.text),
    state: "draft",
  });

  await deliver(
    ctx,
    me.clerkUserId,
    `reply:${id}:preview`,
    {
      kind: "reply_preview",
      actor: await publicPerson(ctx, me._id),
      requestId: request._id,
      replyId: id,
    },
    false,
  );

  return id;
}

const fields = {
  requestId: v.id("paymentRequests"),
  messageId: v.string(),
  text: v.string(),
};

export const prepare = mutation({ args: fields, handler: prepareReply });

export const prepareFromChat = mutation({
  args: { key: v.string(), ...fields },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const user = await requireUser(ctx);

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
      .unique();

    if (
      !conversation ||
      conversation.activeTurn !== args.messageId ||
      conversation.activeUntil < Date.now()
    )
      throw new ConvexError("This reply expired. Ask again.");

    return prepareReply(ctx, args);
  },
});

export const get = query({
  args: { id: v.id("replies") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);

    if (!row || row.clerkUserId !== (await requireUser(ctx)))
      throw new ConvexError("Reply not found.");
    const { me, request, split } = await requestAccess(ctx, row.requestId);

    return {
      reply: row,
      title: split.title,
      other: await publicPerson(
        ctx,
        me._id === request.organizerId
          ? request.participantId
          : request.organizerId,
      ),
    };
  },
});

export const confirm = mutation({
  args: {
    id: v.id("replies"),
    text: v.string(),
    cancel: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, text, cancel }) => {
    const row = await ctx.db.get(id);

    if (!row || row.clerkUserId !== (await requireUser(ctx)))
      throw new ConvexError("Reply not found.");

    if (row.state !== "draft") return;

    if (cancel) {
      await ctx.db.patch(id, { state: "cancelled" });

      return;
    }

    const { me, request, split } = await requestAccess(ctx, row.requestId);
    await requireFriend(ctx, request.organizerId, request.participantId);
    await throttle(ctx, `reply-send:${me._id}`, 10);
    const message = clean(text);

    const other = (await ctx.db.get(
      me._id === request.organizerId
        ? request.participantId
        : request.organizerId,
    ))!;

    await ctx.db.patch(id, { state: "sent", text: message });
    await deliver(ctx, other.clerkUserId, `reply:${id}:sent`, {
      kind: "reply",
      actor: await publicPerson(ctx, me._id),
      requestId: request._id,
      splitId: split._id,
      text: message,
    });
  },
});
