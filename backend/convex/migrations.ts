import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { migratePrivateHistory } from "./privateHistory";

// Admin/CLI only. No user-callable migration or cross-user history endpoint.
export const privateHistory = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("conversations")
      .paginate({ cursor, numItems: 10 });

    let messages = 0;

    for (const conversation of page.page)
      messages += await migratePrivateHistory(ctx, conversation);

    return {
      conversations: page.page.length,
      messages,
      done: page.isDone,
      cursor: page.continueCursor,
    };
  },
});
