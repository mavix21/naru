import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireServer } from "./access";
import { sponsorJobKind, sponsorJobState } from "./validators";

// Only preparation has a lease. A persisted envelope remains locked until its
// on-chain outcome is known, even after a Vercel invocation ends.
const PREPARATION_LEASE_MS = 120_000;

function findJob(ctx: QueryCtx, id: string) {
  return ctx.db
    .query("sponsorJobs")
    .withIndex("by_intent", (q) => q.eq("id", id))
    .unique();
}

async function activeJob(ctx: QueryCtx) {
  const pending = await ctx.db
    .query("sponsorJobs")
    .withIndex("by_state", (q) => q.eq("state", "pending"))
    .first();

  return (
    pending ??
    ctx.db
      .query("sponsorJobs")
      .withIndex("by_state", (q) => q.eq("state", "preparing"))
      .first()
  );
}

async function expirePreparation(ctx: MutationCtx, job: Doc<"sponsorJobs">) {
  if (
    job.state !== "preparing" ||
    job.preparingUntil === null ||
    job.preparingUntil > Date.now()
  )
    return false;

  // pending() fences late workers: an expired preparation can never save or
  // send an envelope. It is therefore safe to release this reservation.
  await ctx.db.patch(job._id, {
    state: "failed",
    preparingUntil: null,
    error:
      "Submission preparation timed out. No transaction was sent. Please retry.",
  });

  return true;
}

export const get = query({
  args: { key: v.string(), id: v.string() },
  handler: (ctx, args) => {
    requireServer(args.key);

    return findJob(ctx, args.id);
  },
});

export const inFlight = query({
  args: { key: v.string() },
  handler: (ctx, args) => {
    requireServer(args.key);

    return activeJob(ctx);
  },
});

export const accountJobs = query({
  args: { key: v.string(), account: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);

    const jobs = await Promise.all(
      (
        [
          "deploy",
          "fund",
          "transfer",
          "swap",
          "split_create",
          "split_pay",
          "split_keep_alive",
        ] as const
      ).map((kind) => {
        const rows = ctx.db
          .query("sponsorJobs")
          .withIndex("by_account_kind", (q) =>
            q.eq("account", args.account).eq("kind", kind),
          )
          .order("desc");

        return kind === "deploy" ? rows.collect() : rows.take(20);
      }),
    );

    return jobs.flat().sort((a, b) => b.created - a.created);
  },
});

export const insert = mutation({
  args: {
    key: v.string(),
    id: v.string(),
    account: v.string(),
    kind: sponsorJobKind,
    func: v.string(),
    auth: v.string(),
    expires: v.number(),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const existing = await findJob(ctx, args.id);

    if (existing) {
      if (
        existing.account !== args.account ||
        existing.kind !== args.kind ||
        existing.func !== args.func ||
        existing.auth !== args.auth ||
        (args.kind !== "fund" && existing.expires !== args.expires)
      )
        throw new ConvexError(
          "Transaction intent already exists with different data.",
        );

      return existing;
    }

    if (args.expires <= Date.now())
      throw new ConvexError("Review expired. Prepare a new transaction.");

    if (args.kind === "deploy" || args.kind === "fund") {
      const previous = await ctx.db
        .query("sponsorJobs")
        .withIndex("by_account_kind", (q) =>
          q.eq("account", args.account).eq("kind", args.kind),
        )
        .filter((q) =>
          args.kind === "fund"
            ? q.and(
                q.neq(q.field("state"), "failed"),
                q.neq(q.field("state"), "confirmed"),
              )
            : q.neq(q.field("state"), "failed"),
        )
        .first();

      if (previous && !(await expirePreparation(ctx, previous))) {
        // Funding is repeatable once confirmed, but simultaneous requests from
        // chat and Account must share the same in-flight top-up.
        if (
          args.kind === "fund" &&
          (previous.state !== "review" || previous.expires > Date.now())
        )
          return previous;

        if (args.kind !== "fund" && previous.func !== args.func)
          throw new ConvexError(
            "Existing transaction has different invocation data.",
          );

        if (previous.state !== "review") return previous;

        // Replacement and uniqueness are one transaction. A concurrent claim
        // either wins first or sees the retired intent and cannot submit it.
        await ctx.db.patch(previous._id, {
          state: "failed",
          error: "Unsubmitted intent replaced by an explicit retry.",
        });
      }
    }

    const id = await ctx.db.insert("sponsorJobs", {
      id: args.id,
      account: args.account,
      kind: args.kind,
      state: "review",
      func: args.func,
      auth: args.auth,
      expires: args.expires,
      created: Date.now(),
      preparingUntil: null,
      hash: null,
      envelope: null,
      ledger: null,
      error: null,
    });

    return (await ctx.db.get(id))!;
  },
});

export const rate = mutation({
  args: { key: v.string(), bucket: v.string(), maximum: v.number() },
  handler: async (ctx, args) => {
    requireServer(args.key);

    if (!Number.isSafeInteger(args.maximum) || args.maximum < 1)
      throw new ConvexError("Invalid sponsorship budget.");

    const limit = await ctx.db
      .query("sponsorLimits")
      .withIndex("by_bucket", (q) => q.eq("bucket", args.bucket))
      .unique();

    if (limit && limit.count >= args.maximum)
      throw new ConvexError(
        "Testnet validation budget reached. Try again in the next window.",
      );

    if (limit) await ctx.db.patch(limit._id, { count: limit.count + 1 });
    else
      await ctx.db.insert("sponsorLimits", { bucket: args.bucket, count: 1 });
  },
});

export const claim = mutation({
  args: { key: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const job = await findJob(ctx, args.id);

    if (!job) throw new ConvexError("Unknown transaction intent.");

    if (job.state !== "review") return false;

    if (job.expires <= Date.now())
      throw new ConvexError("Review expired. Prepare a new transfer.");
    const active = await activeJob(ctx);

    if (active && !(await expirePreparation(ctx, active)))
      throw new ConvexError(
        "Sponsor has an unresolved transaction. Refresh its status before submitting another.",
      );

    // The indexed read and write share a serializable Convex transaction,
    // preserving a single sponsor sequence across concurrent server instances.
    await ctx.db.patch(job._id, {
      state: "preparing",
      preparingUntil: Date.now() + PREPARATION_LEASE_MS,
    });

    return true;
  },
});

export const pending = mutation({
  args: {
    key: v.string(),
    id: v.string(),
    hash: v.string(),
    envelope: v.string(),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const job = await findJob(ctx, args.id);

    if (
      job?.state === "pending" &&
      job.hash === args.hash &&
      job.envelope === args.envelope
    )
      return;

    if (
      !job ||
      job.state !== "preparing" ||
      job.preparingUntil === null ||
      job.preparingUntil <= Date.now() ||
      ((job.kind === "swap" ||
        job.kind === "transfer" ||
        job.kind === "split_create" ||
        job.kind === "split_pay" ||
        job.kind === "split_keep_alive") &&
        job.expires <= Date.now())
    )
      throw new ConvexError("Submission reservation was lost.");

    await ctx.db.patch(job._id, {
      state: "pending",
      hash: args.hash,
      envelope: args.envelope,
      preparingUntil: null,
    });
  },
});

export const finish = mutation({
  args: {
    key: v.string(),
    id: v.string(),
    expectedState: sponsorJobState,
    state: v.union(v.literal("confirmed"), v.literal("failed")),
    ledger: v.union(v.number(), v.null()),
    error: v.union(v.string(), v.null()),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const job = await findJob(ctx, args.id);

    if (!job) throw new ConvexError("Unknown transaction intent.");

    // A lost mutation response or stale reader must never mark an already
    // persisted/confirmed payment as failed or release its sponsor reservation.
    if (
      job.state !== args.expectedState ||
      job.state === "confirmed" ||
      job.state === "failed"
    )
      return;

    if (
      args.state === "confirmed" &&
      (job.state !== "pending" ||
        !job.hash ||
        !job.envelope ||
        args.ledger === null)
    )
      throw new ConvexError("Missing confirmed transaction evidence.");

    await ctx.db.patch(job._id, {
      state: args.state,
      ledger: args.ledger,
      error: args.error,
      result: args.result,
      preparingUntil: null,
    });
  },
});

export const recover = mutation({
  args: { key: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.key);
    const job = await findJob(ctx, args.id);

    if (!job) throw new ConvexError("Unknown transaction intent.");
    await expirePreparation(ctx, job);

    return (await ctx.db.get(job._id))!;
  },
});
