import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireServer, requireUser } from "./access";
import { displayAmount, parseAmount } from "./money";
import { deliver, publicPerson, throttle } from "./socialShared";

const MAX_TARGET_UNITS = BigInt(parseAmount("1000000", "USDC").units);

export function cleanGoal(input: {
  title: string;
  description: string;
  target: string;
}) {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title || title.length > 60 || /[\p{Cc}\p{Cf}]/u.test(title))
    throw new ConvexError("Use a goal title of 1–60 characters.");

  if (description.length > 200 || /[\p{Cc}\p{Cf}]/u.test(description))
    throw new ConvexError(
      "Use a short description of up to 200 characters, on one line.",
    );

  let units: string;

  try {
    units = parseAmount(input.target.trim(), "USDC").units;
  } catch {
    throw new ConvexError(
      "Use a positive USDC target with at most 7 decimal places.",
    );
  }

  if (BigInt(units) > MAX_TARGET_UNITS)
    throw new ConvexError("Targets can be up to 1,000,000 USDC.");

  return { title, description, targetUnits: units };
}

// Whole percent, rounded down, from integer units. May exceed 100.
export function goalPercent(raisedUnits: string, targetUnits: string) {
  return Number((BigInt(raisedUnits) * BigInt(100)) / BigInt(targetUnits));
}

// The public projection: amounts only, never IDs, tips, or wallets.
export function publicGoal(goal: Doc<"supportGoals">) {
  return {
    title: goal.title,
    description: goal.description,
    target: displayAmount(goal.targetUnits),
    raised: displayAmount(goal.raisedUnits),
    percent: goalPercent(goal.raisedUnits, goal.targetUnits),
  };
}

export const publicGoalValidator = v.object({
  title: v.string(),
  description: v.string(),
  target: v.string(),
  raised: v.string(),
  percent: v.number(),
});

export function activeGoal(ctx: QueryCtx, profileId: Id<"profiles">) {
  return ctx.db
    .query("supportGoals")
    .withIndex("by_profile_state", (q) =>
      q.eq("profileId", profileId).eq("state", "active"),
    )
    .unique();
}

// Called only inside the transaction that moves a tip from pending to
// confirmed, so each verified tip is added exactly once. Archived goals still
// receive contributions that were bound to them before they ended.
export async function countContribution(ctx: MutationCtx, tip: Doc<"tips">) {
  if (!tip.goalId) return null;
  const goal = await ctx.db.get(tip.goalId);

  if (!goal || goal.profileId !== tip.recipientProfileId) return null;

  await ctx.db.patch(goal._id, {
    raisedUnits: (BigInt(goal.raisedUnits) + BigInt(tip.units)).toString(),
    contributions: goal.contributions + 1,
    updatedAt: Date.now(),
  });

  return goal;
}

async function owner(ctx: QueryCtx) {
  const clerkUserId = await requireUser(ctx);

  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();

  if (!profile?.username)
    throw new ConvexError("Choose your username before adding a goal.");

  return profile;
}

async function ownedGoal(ctx: QueryCtx, id: Id<"supportGoals">) {
  const profile = await owner(ctx);
  const goal = await ctx.db.get(id);

  if (!goal || goal.profileId !== profile._id)
    throw new ConvexError("Goal not found.");

  return { profile, goal };
}

function ownerView(goal: Doc<"supportGoals">) {
  return {
    _id: goal._id,
    state: goal.state,
    ...publicGoal(goal),
    contributions: goal.contributions,
    // Financial terms freeze once any contribution is confirmed.
    locked: goal.contributions > 0,
    publishedAt: goal.publishedAt ?? null,
    archivedAt: goal.archivedAt ?? null,
  };
}

// The caller must name the goal it intends to replace. A stale form or draft
// card cannot silently end a goal it never showed the owner.
async function activate(
  ctx: MutationCtx,
  profileId: Id<"profiles">,
  replaceId: Id<"supportGoals"> | undefined,
) {
  const current = await activeGoal(ctx, profileId);

  if (current?._id !== replaceId)
    throw new ConvexError(
      current
        ? "You already have an active goal. End or replace it first."
        : "Your goal changed. Review it again.",
    );

  if (current)
    await ctx.db.patch(current._id, {
      state: "archived",
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
}

const terms = {
  title: v.string(),
  description: v.string(),
  target: v.string(),
};

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const clerkUserId = await requireUser(ctx);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (!profile?.username) return null;

    const [active, past] = await Promise.all([
      activeGoal(ctx, profile._id),
      ctx.db
        .query("supportGoals")
        .withIndex("by_profile_state", (q) =>
          q.eq("profileId", profile._id).eq("state", "archived"),
        )
        .order("desc")
        .take(5),
    ]);

    return {
      active: active && ownerView(active),
      past: past.map(ownerView),
    };
  },
});

export const create = mutation({
  args: { ...terms, replaceId: v.optional(v.id("supportGoals")) },
  handler: async (ctx, { replaceId, ...input }) => {
    const profile = await owner(ctx);
    await throttle(ctx, `goal:${profile._id}`, 10);
    const goal = cleanGoal(input);
    await activate(ctx, profile._id, replaceId);
    const now = Date.now();

    return ctx.db.insert("supportGoals", {
      profileId: profile._id,
      clerkUserId: profile.clerkUserId,
      ...goal,
      raisedUnits: "0",
      contributions: 0,
      state: "active",
      source: "owner",
      publishedAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { id: v.id("supportGoals"), ...terms },
  handler: async (ctx, { id, ...input }) => {
    const { profile, goal } = await ownedGoal(ctx, id);

    if (goal.state !== "active")
      throw new ConvexError("Only your active goal can be edited.");
    await throttle(ctx, `goal:${profile._id}`, 10);
    const next = cleanGoal(input);

    if (
      goal.contributions > 0 &&
      (next.title !== goal.title || next.targetUnits !== goal.targetUnits)
    )
      throw new ConvexError(
        "This goal has received contributions, so its title and target are locked. Start a new goal to change them.",
      );

    await ctx.db.patch(id, { ...next, updatedAt: Date.now() });
  },
});

export const archive = mutation({
  args: { id: v.id("supportGoals") },
  handler: async (ctx, { id }) => {
    const { goal } = await ownedGoal(ctx, id);

    if (goal.state !== "active") return;

    await ctx.db.patch(id, {
      state: "archived",
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Naru only drafts. Publishing always needs the owner's explicit confirmation.
export const draftFromChat = mutation({
  args: { key: v.string(), messageId: v.string(), ...terms },
  handler: async (ctx, { key, messageId, ...input }) => {
    requireServer(key);
    const profile = await owner(ctx);

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", profile.clerkUserId),
      )
      .unique();

    if (
      !conversation ||
      conversation.activeTurn !== messageId ||
      conversation.activeUntil < Date.now()
    )
      throw new ConvexError("This draft expired. Ask again.");

    const previous = await ctx.db
      .query("supportGoals")
      .withIndex("by_turn", (q) =>
        q.eq("clerkUserId", profile.clerkUserId).eq("messageId", messageId),
      )
      .unique();

    if (previous) return previous._id;
    await throttle(ctx, `goal-draft:${profile._id}`, 6);

    const id = await ctx.db.insert("supportGoals", {
      profileId: profile._id,
      clerkUserId: profile.clerkUserId,
      ...cleanGoal(input),
      raisedUnits: "0",
      contributions: 0,
      state: "draft",
      source: "naru",
      messageId,
      updatedAt: Date.now(),
    });

    await deliver(
      ctx,
      profile.clerkUserId,
      `goal:${id}:draft`,
      {
        kind: "goal_draft",
        actor: await publicPerson(ctx, profile._id),
        goalId: id,
      },
      false,
    );

    return id;
  },
});

export const draft = query({
  args: { id: v.id("supportGoals") },
  handler: async (ctx, { id }) => {
    const { profile, goal } = await ownedGoal(ctx, id);
    const current = await activeGoal(ctx, profile._id);

    return {
      goal: ownerView(goal),
      username: profile.username!,
      active:
        current && current._id !== id
          ? { _id: current._id, title: current.title }
          : null,
    };
  },
});

export const publishDraft = mutation({
  args: {
    id: v.id("supportGoals"),
    replaceId: v.optional(v.id("supportGoals")),
    ...terms,
  },
  handler: async (ctx, { id, replaceId, ...input }) => {
    const { profile, goal } = await ownedGoal(ctx, id);

    if (goal.state !== "draft")
      throw new ConvexError("This draft was already handled.");
    await throttle(ctx, `goal:${profile._id}`, 10);
    const next = cleanGoal(input);
    await activate(ctx, profile._id, replaceId);

    await ctx.db.patch(id, {
      ...next,
      state: "active",
      publishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const discardDraft = mutation({
  args: { id: v.id("supportGoals") },
  handler: async (ctx, { id }) => {
    const { goal } = await ownedGoal(ctx, id);

    if (goal.state === "draft")
      await ctx.db.patch(id, { state: "discarded", updatedAt: Date.now() });
  },
});
