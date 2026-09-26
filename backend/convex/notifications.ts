import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireUser } from "./access";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const [items, unread] = await Promise.all([
      ctx.db
        .query("notifications")
        .withIndex("by_owner", (q) => q.eq("clerkUserId", user))
        .order("desc")
        .take(50),
      ctx.db
        .query("notifications")
        .withIndex("by_unread", (q) =>
          q.eq("clerkUserId", user).eq("read", false),
        )
        .collect(),
    ]);

    const rows = [
      ...new Map([...items, ...unread].map((n) => [n._id, n])).values(),
    ].sort((a, b) => b._creationTime - a._creationTime);

    return {
      unread: unread.length,
      items: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          requestState: row.requestId
            ? (await ctx.db.get(row.requestId))?.state
            : null,
          friendState: row.friendshipId
            ? (await ctx.db.get(row.friendshipId))?.state
            : null,
        })),
      ),
    };
  },
});

export const markRead = mutation({
  args: { id: v.optional(v.id("notifications")) },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);

    if (id) {
      const row = await ctx.db.get(id);

      if (!row || row.clerkUserId !== user)
        throw new ConvexError("Notification not found.");
      await ctx.db.patch(id, { read: true });
    } else {
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_unread", (q) =>
          q.eq("clerkUserId", user).eq("read", false),
        )
        .collect();

      for (const row of rows) await ctx.db.patch(row._id, { read: true });
    }
  },
});
