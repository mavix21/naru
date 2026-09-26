import { ConvexError } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import { requireUser } from "./access";

export function profileFor(ctx: QueryCtx, user: string) {
  return ctx.db
    .query("profiles")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();
}

export async function socialUser(ctx: QueryCtx) {
  const profile = await profileFor(ctx, await requireUser(ctx));

  if (!profile?.username)
    throw new ConvexError("Choose your username in People first.");

  return profile;
}

export async function publicPerson(ctx: QueryCtx, id: Id<"profiles">) {
  const profile = await ctx.db.get(id);

  if (!profile?.username)
    throw new ConvexError("This person has not set up their Naru identity.");

  const companion = await ctx.db
    .query("companions")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", profile.clerkUserId))
    .unique();

  if (!companion) throw new ConvexError("Naru companion not found.");

  return {
    userId: id,
    username: profile.username,
    displayName: profile.displayName || profile.username,
    companionName: companion.name,
    accent: companion.accent,
  };
}

export function relationship(
  ctx: QueryCtx,
  a: Id<"profiles">,
  b: Id<"profiles">,
) {
  const [low, high] = [a, b].sort();

  return ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("low", low).eq("high", high))
    .unique();
}

export async function requireFriend(
  ctx: QueryCtx,
  a: Id<"profiles">,
  b: Id<"profiles">,
) {
  if (a === b || (await relationship(ctx, a, b))?.state !== "accepted")
    throw new ConvexError("Choose an accepted friend from People.");
}

export async function throttle(
  ctx: MutationCtx,
  key: string,
  maximum: number,
  duration = 60_000,
) {
  const window = Math.floor(Date.now() / duration);

  const row = await ctx.db
    .query("socialLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (row?.window === window && row.count >= maximum)
    throw new ConvexError("A little pause, please. Try again later.");

  if (row)
    await ctx.db.patch(row._id, {
      window,
      count: row.window === window ? row.count + 1 : 1,
    });
  else await ctx.db.insert("socialLimits", { key, window, count: 1 });
}

export async function notify(
  ctx: MutationCtx,
  user: string,
  eventKey: string,
  fields: Omit<
    Doc<"notifications">,
    "_id" | "_creationTime" | "clerkUserId" | "eventKey" | "read"
  >,
) {
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_event", (q) =>
      q.eq("clerkUserId", user).eq("eventKey", eventKey),
    )
    .unique();

  if (!existing)
    await ctx.db.insert("notifications", {
      clerkUserId: user,
      eventKey,
      read: false,
      ...fields,
    });
}

// Delivery and notification are in the same transaction as their source state.
// No model invocation and no private conversation content crosses accounts.
export async function deliver(
  ctx: MutationCtx,
  user: string,
  eventKey: string,
  event: NonNullable<Doc<"messages">["event"]>,
  notification = true,
) {
  let conversation = await ctx.db
    .query("conversations")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", user))
    .unique();

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

  const messageId = `social-${eventKey}`;

  const existing = await ctx.db
    .query("messages")
    .withIndex("by_message", (q) =>
      q.eq("conversationId", conversation._id).eq("messageId", messageId),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("messages", {
      conversationId: conversation._id,
      messageId,
      sequence: conversation.sequence + 1,
      role: "assistant",
      content: JSON.stringify({ id: messageId, role: "assistant", parts: [] }),
      event,
    });
    await ctx.db.patch(conversation._id, {
      sequence: conversation.sequence + 1,
    });
  }

  if (notification)
    await notify(ctx, user, eventKey, {
      kind: event.kind,
      actor: event.actor,
      requestId: event.requestId,
      splitId: event.splitId,
      messageId,
    });
}

export async function validateMentions(
  ctx: QueryCtx,
  user: string,
  text: string,
  mentions: NonNullable<Doc<"messages">["mentions"]>,
) {
  if (mentions.length > 12) throw new ConvexError("Mention up to 12 friends.");

  if (!mentions.length) return;
  const me = await profileFor(ctx, user);

  if (!me?.username)
    throw new ConvexError("Choose your username in People first.");
  let end = 0;

  for (const mention of mentions) {
    if (
      !Number.isInteger(mention.start) ||
      !Number.isInteger(mention.end) ||
      mention.start < end ||
      mention.end > text.length ||
      mention.start >= mention.end ||
      !/^@[a-z0-9_]{3,24}$/.test(mention.label) ||
      text.slice(mention.start, mention.end) !== mention.label
    )
      throw new ConvexError("A mention changed. Select your friend again.");
    await requireFriend(ctx, me._id, mention.userId);
    end = mention.end;
  }
}
