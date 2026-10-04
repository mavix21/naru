import { createThread } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import { api, components } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "swap-tests-server-key-32-characters";

beforeEach(() => {
  process.env.NARU_PAYMENTS_KEY = key;
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const owner = t.withIdentity({ subject: "owner" });
  const expires = Date.now() + 120_000;
  await t.run(async (ctx) => {
    await ctx.db.insert("conversations", {
      agentThreadId: await createThread(ctx, components.agent, {
        userId: "owner",
      }),
      clerkUserId: "owner",
      sequence: 1,
      activeTurn: "turn",
      activeUntil: expires,
      error: null,
    });
    await ctx.db.insert("payments", {
      clerkUserId: "owner",
      device: "device",
      attempt: "attempt",
      started: true,
      account: "account",
      credentialId: "credential",
      publicKey: "public-key",
      deployment: null,
      candidate: null,
      challenge: null,
      expires: null,
      state: "ready",
      balance: "50000000",
      balanceError: null,
      job: null,
      updatedAt: Date.now(),
    });
  });
  await t.mutation(api.sponsorship.insert, {
    key,
    id: "review",
    account: "account",
    kind: "swap",
    func: "reviewed-function",
    auth: "reviewed-auth",
    expires,
  });
  const prepared = {
    key,
    messageId: "turn",
    account: "account",
    token: "xlm",
    amount: "1",
    units: "10000000",
    reviewId: "review",
    swap: {
      assetOut: "USDC" as const,
      tokenOut: "usdc",
      router: "router",
      pool: "pool",
      expectedOut: "1000000",
      minimumOut: "995000",
      slippageBps: 50 as const,
      quotedAt: expires - 120_000,
      expiresAt: expires,
      deadline: Math.floor(expires / 1000),
    },
  };
  const id = await owner.mutation(api.operations.prepareSwap, prepared);
  return { t, owner, id, prepared, expires };
}

describe("durable swap lifecycle", () => {
  it("publishes a receipt only after matching confirmation and preserves it against stale reports", async () => {
    const { t, owner, id } = await setup();
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "submit", reviewId: "review" },
    });
    await t.mutation(api.sponsorship.claim, { key, id: "review" });
    await t.mutation(api.sponsorship.pending, {
      key,
      id: "review",
      hash: "a".repeat(64),
      envelope: "signed-envelope",
    });
    await t.mutation(api.sponsorship.finish, {
      key,
      id: "review",
      state: "confirmed",
      expectedState: "pending",
      ledger: 123,
      error: null,
      result: "verified-result",
    });
    const report = {
      kind: "report" as const,
      reviewId: "review",
      state: "confirmed" as const,
      hash: "a".repeat(64),
      error: null,
      receivedUnits: "1000000",
    };
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { ...report, receivedUnits: "994999" },
      }),
    ).rejects.toThrow(/evidence/);
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: report,
    });
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { ...report, state: "submitting", receivedUnits: undefined },
    });
    const receipt = await owner.query(api.operations.get, { id });
    expect(receipt.state).toBe("confirmed");
    expect(receipt.receivedUnits).toBe("1000000");
    expect(receipt.hash).toBe("a".repeat(64));
  });
  it("cannot submit a cancelled swap", async () => {
    const { owner, id } = await setup();
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "cancel" },
    });
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 2,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/no longer/);
  });
  it("deduplicates repeated preparation in one conversation turn", async () => {
    const { t, owner, prepared, id } = await setup();
    expect(await owner.mutation(api.operations.prepareSwap, prepared)).toBe(id);
    expect(
      await t.run((ctx) => ctx.db.query("operations").collect()),
    ).toHaveLength(1);
  });
  it("requires ownership and the server key", async () => {
    const { t, owner, id } = await setup();
    await expect(
      t.withIdentity({ subject: "other" }).query(api.operations.get, { id }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.operations.change, {
        key: "wrong",
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow();
  });
  it("atomically claims an operation only once across concurrent authorizations", async () => {
    const { owner, id } = await setup();
    const submit = () =>
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      });
    const result = await Promise.allSettled([submit(), submit()]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await owner.query(api.operations.get, { id })).state).toBe(
      "submitting",
    );
  });
  it("rejects expired quotes and edited terms", async () => {
    const { t, owner, id } = await setup();
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "edit", amount: "2", units: "20000000" },
      }),
    ).rejects.toThrow(/quote/);
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(id))!;
      await ctx.db.patch(id, {
        swap: { ...row.swap!, deadline: Math.floor(Date.now() / 1000) - 1 },
      });
    });
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/expired/);
  });
  it("retires old review IDs and revisions when a quote is refreshed", async () => {
    const { t, owner, id, prepared, expires } = await setup();
    await t.mutation(api.sponsorship.insert, {
      key,
      id: "new-review",
      account: "account",
      kind: "swap",
      func: "new-function",
      auth: "new-auth",
      expires,
    });
    await owner.mutation(api.operations.prepareSwap, {
      ...prepared,
      id,
      revision: 1,
      reviewId: "new-review",
    });
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 2,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/Authorization/);
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 2,
      action: { kind: "submit", reviewId: "new-review" },
    });
    expect((await owner.query(api.operations.get, { id })).reviewId).toBe(
      "new-review",
    );
  });
  it("never treats a submitted hash as confirmation", async () => {
    const { owner, id } = await setup();
    await owner.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "submit", reviewId: "review" },
    });
    await expect(
      owner.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: {
          kind: "report",
          reviewId: "review",
          state: "confirmed",
          hash: "a".repeat(64),
          error: null,
          receivedUnits: "1000000",
        },
      }),
    ).rejects.toThrow(/evidence/);
    expect((await owner.query(api.operations.get, { id })).state).toBe(
      "submitting",
    );
  });
  it("keeps an ambiguous persisted envelope locked and rejects a second sponsor claim", async () => {
    const { t, expires } = await setup();
    const claims = await Promise.all([
      t.mutation(api.sponsorship.claim, { key, id: "review" }),
      t.mutation(api.sponsorship.claim, { key, id: "review" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await t.mutation(api.sponsorship.pending, {
      key,
      id: "review",
      hash: "a".repeat(64),
      envelope: "signed-envelope",
    });
    await t.mutation(api.sponsorship.insert, {
      key,
      id: "second",
      account: "account",
      kind: "swap",
      func: "f",
      auth: "a",
      expires,
    });
    await expect(
      t.mutation(api.sponsorship.claim, { key, id: "second" }),
    ).rejects.toThrow(/unresolved/);
    await t.mutation(api.sponsorship.finish, {
      key,
      id: "review",
      state: "failed",
      expectedState: "review",
      ledger: null,
      error: "stale worker",
    });
    const record = await t.query(api.sponsorship.get, { key, id: "review" });
    expect(record?.state).toBe("pending");
    expect(record?.envelope).toBe("signed-envelope");
  });
  it("fences a worker whose quote expired during submission preparation", async () => {
    const { t } = await setup();
    await t.mutation(api.sponsorship.claim, { key, id: "review" });
    await t.run(async (ctx) => {
      const job = await ctx.db
        .query("sponsorJobs")
        .withIndex("by_intent", (q) => q.eq("id", "review"))
        .unique();
      await ctx.db.patch(job!._id, { expires: Date.now() - 1 });
    });
    await expect(
      t.mutation(api.sponsorship.pending, {
        key,
        id: "review",
        hash: "a".repeat(64),
        envelope: "late-envelope",
      }),
    ).rejects.toThrow(/reservation/);
    expect(
      (await t.query(api.sponsorship.get, { key, id: "review" }))?.envelope,
    ).toBeNull();
  });
});
