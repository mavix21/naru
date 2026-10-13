/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../convex/_generated/dataModel";

import { api } from "../convex/_generated/api";
import { parseAmount } from "../convex/money";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "goal-tests-server-key-0123456789abcdef";
const ACCOUNT = `C${"A".repeat(55)}`;

beforeEach(() => vi.stubEnv("NARU_PAYMENTS_KEY", key));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);

  for (const [clerkUserId, username] of [
    ["alice", "alice"],
    ["bob", "bob_b"],
  ]) {
    await t.mutation(api.profiles.seedIdentity, {
      key,
      clerkUserId,
      suggestedName: clerkUserId,
    });
    const claim = await t.mutation(api.profiles.prepareUsername, {
      key,
      clerkUserId,
      username,
    });
    await t.mutation(api.profiles.finishUsername, {
      key,
      clerkUserId,
      claimId: claim.claimId!,
      username,
    });
    await t
      .withIdentity({ subject: clerkUserId })
      .mutation(api.companions.save, { name: "Pip", accent: "coral" });
  }

  await t.run((ctx) =>
    ctx.db.insert("payments", {
      clerkUserId: "alice",
      device: "d",
      attempt: "a",
      started: true,
      account: ACCOUNT,
      credentialId: "cred",
      publicKey: "pk",
      deployment: null,
      candidate: null,
      challenge: null,
      expires: null,
      state: "ready",
      balance: "0",
      balanceError: null,
      usdcBalance: "0",
      usdcBalanceError: null,
      job: null,
      updatedAt: Date.now(),
    }),
  );

  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

let sequence = 0;

// Each tip uses a fresh payer: the server throttles per sender.
async function tip(t: T, amount: string) {
  sequence += 1;
  const checkout = `checkout-${sequence}`;
  const { units } = parseAmount(amount, "USDC");

  const { goal } = await t.mutation(api.tips.create, {
    key,
    checkout,
    username: "alice",
    recipientAccount: ACCOUNT,
    sender: `G${String(sequence).padStart(55, "B")}`,
    amount,
    units,
    fee: "100",
    envelope: "envelope",
    hash: `hash-${sequence}`,
    expiresAt: Date.now() + 60_000,
  });

  return { checkout, goal };
}

async function send(t: T, checkout: string) {
  await t.mutation(api.tips.submit, {
    key,
    checkout,
    signedEnvelope: "signed",
  });
}

function finish(t: T, checkout: string, state: "confirmed" | "failed") {
  return t.mutation(api.tips.finish, {
    key,
    checkout,
    expected: "pending",
    state,
    ledger: 1,
  });
}

async function confirm(t: T, amount: string) {
  const { checkout } = await tip(t, amount);
  await send(t, checkout);
  await finish(t, checkout, "confirmed");

  return checkout;
}

function publicGoal(t: T) {
  return t
    .query(api.profiles.publicByUsername, { username: "alice" })
    .then((profile) => profile!.goal);
}

const goal = { title: "New tablet", description: "For drawing", target: "10" };

describe("support goals", () => {
  it("lets only the owner create, edit and end a goal", async () => {
    const { t, alice, bob } = await setup();
    await expect(t.mutation(api.goals.create, goal)).rejects.toThrow();
    const id = await alice.mutation(api.goals.create, goal);

    await expect(
      bob.mutation(api.goals.update, { id, ...goal, title: "Mine now" }),
    ).rejects.toThrow(/not found/);
    await expect(bob.mutation(api.goals.archive, { id })).rejects.toThrow(
      /not found/,
    );
    expect((await publicGoal(t))?.title).toBe("New tablet");

    await alice.mutation(api.goals.update, { id, ...goal, target: "12.5" });
    expect((await publicGoal(t))?.target).toBe("12.5");
    await alice.mutation(api.goals.archive, { id });
    expect(await publicGoal(t)).toBeNull();
    expect((await alice.query(api.goals.mine))?.past).toHaveLength(1);
  });

  it.each([
    { ...goal, target: "0" },
    { ...goal, target: "-1" },
    { ...goal, target: "1.12345678" },
    { ...goal, target: "1000000.0000001" },
    { ...goal, title: " " },
    { ...goal, title: "x".repeat(61) },
    { ...goal, description: "line\nbreak" },
  ])("rejects invalid terms %o", async (terms) => {
    const { alice } = await setup();
    await expect(alice.mutation(api.goals.create, terms)).rejects.toThrow();
  });

  it("keeps one active goal and requires naming the goal being replaced", async () => {
    const { alice } = await setup();
    const first = await alice.mutation(api.goals.create, goal);
    await expect(alice.mutation(api.goals.create, goal)).rejects.toThrow(
      /already have an active goal/,
    );
    const second = await alice.mutation(api.goals.create, {
      ...goal,
      title: "Second",
      replaceId: first,
    });
    // A stale form that still references the first goal can't replace again.
    await expect(
      alice.mutation(api.goals.create, { ...goal, replaceId: first }),
    ).rejects.toThrow();
    const mine = await alice.query(api.goals.mine);
    expect(mine?.active?._id).toBe(second);
    expect(mine?.past.map((row) => row._id)).toEqual([first]);
  });

  it("publishes only the public projection, never drafts or tip details", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, goal);
    await confirm(t, "2.5");
    const profile = await t.query(api.profiles.publicByUsername, {
      username: "alice",
    });
    expect(profile?.goal).toEqual({
      title: "New tablet",
      description: "For drawing",
      target: "10",
      raised: "2.5",
      percent: 25,
    });
    expect(JSON.stringify(profile)).not.toMatch(/G[B0-9]{55}|hash-|_id/);
    await expect(
      t.query(api.tips.goal, { key: "wrong", checkout: "checkout-1" }),
    ).rejects.toThrow();
  });

  it("adds integer units exactly and reports totals past the target", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, { ...goal, target: "0.3" });
    for (let i = 0; i < 3; i++) await confirm(t, "0.1");
    expect(await publicGoal(t)).toMatchObject({ raised: "0.3", percent: 100 });
    await confirm(t, "0.0000001");
    await confirm(t, "0.15");
    expect(await publicGoal(t)).toMatchObject({
      raised: "0.4500001",
      percent: 150,
    });
  });

  it("rounds percent down without floating point drift", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, { ...goal, target: "3" });
    await confirm(t, "0.9999999");
    expect(await publicGoal(t)).toMatchObject({
      raised: "0.9999999",
      percent: 33,
    });
  });

  it("counts neither review, pending nor failed payments", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, goal);
    await tip(t, "1");
    const pending = await tip(t, "2");
    await send(t, pending.checkout);
    const failed = await tip(t, "3");
    await send(t, failed.checkout);
    await finish(t, failed.checkout, "failed");
    expect(await publicGoal(t)).toMatchObject({ raised: "0", percent: 0 });

    // A late "confirmed" for an already-failed tip changes nothing.
    await finish(t, failed.checkout, "confirmed");
    expect(await publicGoal(t)).toMatchObject({ raised: "0" });
  });

  it("counts concurrent and retried confirmations exactly once", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, goal);
    const { checkout } = await tip(t, "4");
    await send(t, checkout);
    await Promise.all([
      finish(t, checkout, "confirmed"),
      finish(t, checkout, "confirmed"),
      finish(t, checkout, "confirmed"),
    ]);
    await finish(t, checkout, "confirmed");
    expect(await publicGoal(t)).toMatchObject({ raised: "4", percent: 40 });
    expect((await alice.query(api.goals.mine))?.active?.contributions).toBe(1);

    // One receipt and one notification, carrying the goal it counted toward.
    const [messages, notifications] = await t.run(async (ctx) => [
      (await ctx.db.query("messages").collect()).filter(
        (row) => row.event?.kind === "tip_received",
      ),
      await ctx.db.query("notifications").collect(),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].event?.tip?.goal).toBe("New tablet");
    expect(notifications).toHaveLength(1);
  });

  it("keeps pending checkouts attributed to the goal they were reviewed under", async () => {
    const { t, alice } = await setup();
    const first = await alice.mutation(api.goals.create, goal);
    const before = await tip(t, "3");
    expect(before.goal).toEqual({ title: "New tablet" });
    await send(t, before.checkout);

    await alice.mutation(api.goals.create, {
      ...goal,
      title: "Replacement",
      replaceId: first,
    });
    await finish(t, before.checkout, "confirmed");
    await confirm(t, "1");

    const mine = await alice.query(api.goals.mine);
    expect(mine?.past[0]).toMatchObject({ title: "New tablet", raised: "3" });
    expect(mine?.active).toMatchObject({ title: "Replacement", raised: "1" });
    expect(
      await t.query(api.tips.goal, { key, checkout: before.checkout }),
    ).toMatchObject({ title: "New tablet", raised: "3", active: false });
  });

  it("never assigns tips created before the goal, including legacy tips", async () => {
    const { t, alice } = await setup();
    const legacy = await tip(t, "5");
    expect(legacy.goal).toBeNull();
    await send(t, legacy.checkout);
    await alice.mutation(api.goals.create, goal);
    await finish(t, legacy.checkout, "confirmed");
    expect(await publicGoal(t)).toMatchObject({ raised: "0" });
    expect(
      await t.query(api.tips.goal, { key, checkout: legacy.checkout }),
    ).toBeNull();
  });

  it("freezes title and target after the first confirmed contribution", async () => {
    const { t, alice } = await setup();
    const id = await alice.mutation(api.goals.create, goal);
    const { checkout } = await tip(t, "1");
    await send(t, checkout);
    // Pending contributions do not lock terms yet.
    await alice.mutation(api.goals.update, { id, ...goal, target: "20" });
    await finish(t, checkout, "confirmed");

    await expect(
      alice.mutation(api.goals.update, { id, ...goal, target: "20.5" }),
    ).rejects.toThrow(/locked/);
    await expect(
      alice.mutation(api.goals.update, {
        ...goal,
        id,
        target: "20",
        title: "X",
      }),
    ).rejects.toThrow(/locked/);
    await alice.mutation(api.goals.update, {
      id,
      ...goal,
      target: "20",
      description: "Clarified copy",
    });
    expect(await publicGoal(t)).toMatchObject({
      title: "New tablet",
      target: "20",
      description: "Clarified copy",
      raised: "1",
    });
  });

  it("does not reduce progress when the recipient spends received funds", async () => {
    const { t, alice } = await setup();
    await alice.mutation(api.goals.create, goal);
    await confirm(t, "6");
    await t.run(async (ctx) => {
      const payment = await ctx.db.query("payments").first();
      await ctx.db.patch(payment!._id, { usdcBalance: "0", balance: "0" });
    });
    expect(await publicGoal(t)).toMatchObject({ raised: "6", percent: 60 });
  });

  it("only publishes a Naru draft after explicit owner confirmation", async () => {
    const { t, alice, bob } = await setup();
    const existing = await alice.mutation(api.goals.create, goal);
    await t.run((ctx) =>
      ctx.db.insert("conversations", {
        clerkUserId: "alice",
        sequence: 0,
        activeTurn: "turn-1",
        activeUntil: Date.now() + 60_000,
        error: null,
      }),
    );
    const draftArgs = {
      messageId: "turn-1",
      title: "Studio rent",
      description: "",
      target: "50",
    };
    await expect(
      alice.mutation(api.goals.draftFromChat, { key: "wrong", ...draftArgs }),
    ).rejects.toThrow();
    const draft: Id<"supportGoals"> = await alice.mutation(
      api.goals.draftFromChat,
      { key, ...draftArgs },
    );
    // Retrying the same turn reuses its draft.
    expect(
      await alice.mutation(api.goals.draftFromChat, { key, ...draftArgs }),
    ).toBe(draft);
    expect((await publicGoal(t))?.title).toBe("New tablet");
    await expect(bob.query(api.goals.draft, { id: draft })).rejects.toThrow();

    const terms = { title: "Studio rent", description: "", target: "60" };
    await expect(
      alice.mutation(api.goals.publishDraft, { id: draft, ...terms }),
    ).rejects.toThrow(/active goal/);
    await alice.mutation(api.goals.publishDraft, {
      id: draft,
      replaceId: existing,
      ...terms,
    });
    expect(await publicGoal(t)).toMatchObject({
      title: "Studio rent",
      target: "60",
    });
    await expect(
      alice.mutation(api.goals.publishDraft, { id: draft, ...terms }),
    ).rejects.toThrow(/already handled/);
  });

  it("leaves profiles without goals accepting ordinary tips", async () => {
    const { t } = await setup();
    expect(await publicGoal(t)).toBeNull();
    const checkout = await confirm(t, "1");
    const row = await t.query(api.tips.get, { key, checkout });
    expect(row?.state).toBe("confirmed");
    expect(row?.goalId).toBeUndefined();
  });
});
