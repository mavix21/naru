import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireUser } from "./access";
import {
  notify,
  profileFor,
  publicPerson,
  relationship,
  socialUser,
  throttle,
} from "./socialShared";

export const claimUsername = mutation({
  args: { username: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const username = args.username.trim().toLowerCase();
    const displayName = args.displayName.trim();

    if (!/^[a-z][a-z0-9_]{2,23}$/.test(username))
      throw new ConvexError(
        "Use 3–24 letters, numbers or underscores, starting with a letter.",
      );

    if (
      !displayName ||
      displayName.length > 60 ||
      /[\p{Cc}\p{Cf}]/u.test(displayName)
    )
      throw new ConvexError("Use a display name of 1–60 characters.");
    const profile = await profileFor(ctx, user);

    if (!profile) throw new ConvexError("Save your companion first.");

    // The index read participates in Convex's serializable transaction, including
    // empty-range conflicts: simultaneous case-insensitive claims cannot both win.
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    if (existing && existing._id !== profile._id)
      throw new ConvexError("That username is already taken.");
    await throttle(ctx, `username:${user}`, 6);
    await ctx.db.patch(profile._id, {
      username,
      displayName,
      updatedAt: Date.now(),
    });
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const profile = await profileFor(ctx, await requireUser(ctx));

    if (!profile?.username)
      return { me: null, friends: [], incoming: [], outgoing: [] };

    const rows = [
      ...(await ctx.db
        .query("friendships")
        .withIndex("by_low", (q) => q.eq("low", profile._id))
        .collect()),
      ...(await ctx.db
        .query("friendships")
        .withIndex("by_high", (q) => q.eq("high", profile._id))
        .collect()),
    ];

    const visible = await Promise.all(
      rows.flatMap((row) =>
        row.state === "accepted" || row.state === "pending"
          ? [
              publicPerson(
                ctx,
                row.low === profile._id ? row.high : row.low,
              ).then((person) => ({
                id: row._id,
                state: row.state,
                incoming: row.initiator !== profile._id,
                person,
              })),
            ]
          : [],
      ),
    );

    return {
      me: await publicPerson(ctx, profile._id),
      friends: visible.filter((r) => r.state === "accepted"),
      incoming: visible.filter((r) => r.state === "pending" && r.incoming),
      outgoing: visible.filter((r) => r.state === "pending" && !r.incoming),
    };
  },
});

// Exact, authenticated, rate-limited discovery. No prefix scans or directory API.
export const findUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await socialUser(ctx);
    await throttle(ctx, `search:${me._id}`, 20);
    const exact = username.trim().replace(/^@/, "").toLowerCase();

    if (!/^[a-z][a-z0-9_]{2,23}$/.test(exact)) return null;

    const found = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", exact))
      .unique();

    return found ? publicPerson(ctx, found._id) : null;
  },
});

export const friendAction = mutation({
  args: {
    personId: v.id("profiles"),
    action: v.union(
      v.literal("send"),
      v.literal("accept"),
      v.literal("decline"),
      v.literal("cancel"),
      v.literal("remove"),
    ),
  },
  handler: async (ctx, { personId, action }) => {
    const me = await socialUser(ctx);

    if (personId === me._id)
      throw new ConvexError("You can’t send yourself a friend request.");
    const person = await ctx.db.get(personId);

    if (!person?.username) throw new ConvexError("Person not found.");
    await publicPerson(ctx, personId);
    const row = await relationship(ctx, me._id, personId);
    const actor = await publicPerson(ctx, me._id);

    if (action === "send") {
      if (
        row?.state === "accepted" ||
        (row?.state === "pending" && row.initiator === me._id)
      )
        return;

      if (row?.state === "pending")
        throw new ConvexError(
          "They already invited you. Accept their request in People.",
        );

      if (row && Date.now() - row.updatedAt < 86_400_000)
        throw new ConvexError(
          "Please wait a day before inviting this person again.",
        );
      await throttle(ctx, `friend:${me._id}`, 10, 3_600_000);
      const [low, high] = [me._id, personId].sort();
      const generation = (row?.generation ?? 0) + 1;

      const fields = {
        low,
        high,
        initiator: me._id,
        state: "pending" as const,
        generation,
        updatedAt: Date.now(),
      };

      const id = row?._id ?? (await ctx.db.insert("friendships", fields));

      if (row) await ctx.db.patch(id, fields);
      await notify(
        ctx,
        person.clerkUserId,
        `friend:${id}:${generation}:request`,
        { kind: "friend_request", actor, friendshipId: id },
      );

      return;
    }

    if (!row) throw new ConvexError("Friend request not found.");

    const state =
      action === "accept"
        ? "accepted"
        : action === "decline"
          ? "declined"
          : action === "cancel"
            ? "cancelled"
            : "removed";

    if (row.state === state) return;

    if (
      action === "remove"
        ? row.state !== "accepted"
        : row.state !== "pending" ||
          (action === "cancel"
            ? row.initiator !== me._id
            : row.initiator === me._id)
    )
      throw new ConvexError("This relationship changed. Refresh People.");
    await ctx.db.patch(row._id, { state, updatedAt: Date.now() });

    if (action === "accept")
      await notify(
        ctx,
        person.clerkUserId,
        `friend:${row._id}:${row.generation}:accepted`,
        { kind: "friend_accepted", actor, friendshipId: row._id },
      );
  },
});
