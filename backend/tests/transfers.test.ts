/// <reference types="vite/client" />
import { createThread } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import { api, components } from "../convex/_generated/api";
import { TESTNET_ASSETS } from "../convex/money";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "transfer-tests-server-key-32-characters";
beforeEach(() => {
  process.env.NARU_PAYMENTS_KEY = key;
});

async function setup(asset: "USDC" | "XLM" = "USDC") {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const sender = t.withIdentity({ subject: "sender" });
  const recipient = t.withIdentity({ subject: "recipient" });
  const records = await t.run(async (ctx) => {
    const profiles = [];
    const wallets = [];
    for (const user of ["sender", "recipient"]) {
      profiles.push(
        await ctx.db.insert("profiles", {
          clerkUserId: user,
          username: user,
          displayName: user,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          preferredGreeting: "Hi",
          onboardingStatus: "complete",
        }),
      );
      await ctx.db.insert("companions", {
        clerkUserId: user,
        name: "Naru",
        accent: "sky",
        paymentChoiceMade: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      wallets.push(
        await ctx.db.insert("payments", {
          clerkUserId: user,
          device: "device",
          attempt: "attempt",
          started: true,
          account: `${user}-account`,
          credentialId: "credential",
          publicKey: "public-key",
          deployment: null,
          candidate: null,
          challenge: null,
          expires: null,
          state: "ready",
          balance: "100000000",
          balanceError: null,
          usdcBalance: user === "sender" ? "20000000" : "0",
          usdcBalanceError: null,
          job: null,
          updatedAt: Date.now(),
        }),
      );
    }
    const [low, high] = [...profiles].sort();
    const friendship = await ctx.db.insert("friendships", {
      low,
      high,
      initiator: profiles[0],
      state: "accepted",
      generation: 1,
      updatedAt: Date.now(),
    });
    const conversation = await ctx.db.insert("conversations", {
      agentThreadId: await createThread(ctx, components.agent, {
        userId: "sender",
      }),
      clerkUserId: "sender",
      sequence: 1,
      activeTurn: "turn",
      activeUntil: Date.now() + 120_000,
      error: null,
    });
    await ctx.db.insert("messages", {
      conversationId: conversation,
      messageId: "turn",
      sequence: 1,
      role: "user",
      agentMessageIds: [],
      mentions: [
        { userId: profiles[1], start: 10, end: 20, label: "@recipient" },
      ],
    });
    return { profiles, wallets, friendship };
  });
  const prepared = {
    key,
    messageId: "turn",
    recipientUserId: "recipient",
    recipientEmail: "",
    recipientName: "Untrusted name",
    recipientProfileId: records.profiles[1],
    recipientUsername: "wrong",
    recipient: "recipient-account",
    account: "sender-account",
    token: TESTNET_ASSETS[asset],
    asset,
    amount: "1",
    units: "10000000",
  };
  const prepare = () => sender.mutation(api.operations.prepare, prepared);
  const review = async () => {
    const id = await prepare();
    await t.mutation(api.sponsorship.insert, {
      key,
      id: "review",
      account: prepared.account,
      kind: "transfer",
      func: "server-validated-func",
      auth: "server-validated-auth",
      expires: Date.now() + 120_000,
    });
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "bind", reviewId: "review" },
    });
    return id;
  };
  return { t, sender, recipient, prepared, prepare, review, ...records };
}

describe("durable friend transfers", () => {
  it.each(["USDC", "XLM"] as const)(
    "keeps %s drafts idempotent and derives the visible recipient from verified identity",
    async (asset) => {
      const { t, sender, prepare } = await setup(asset);
      const id = await prepare();
      expect(await prepare()).toBe(id);
      const saved = await sender.query(api.operations.get, { id });
      expect(saved).toMatchObject({
        asset,
        token: TESTNET_ASSETS[asset],
        recipientName: "recipient",
        recipientUsername: "recipient",
        state: "awaiting_approval",
      });
      expect(
        await t.run((ctx) => ctx.db.query("sponsorJobs").collect()),
      ).toHaveLength(0);
    },
  );
  it("rejects unaccepted friendship, inactive recipients, missing mentions, and altered units or token", async () => {
    const { t, sender, prepare, prepared, friendship, wallets } = await setup();
    await t.run((ctx) => ctx.db.patch(friendship, { state: "pending" }));
    await expect(prepare()).rejects.toThrow(/accepted friend/);
    await t.run(async (ctx) => {
      await ctx.db.patch(friendship, { state: "accepted" });
      await ctx.db.patch(wallets[1], { state: "pending" });
    });
    await expect(prepare()).rejects.toThrow(/active/);
    await t.run((ctx) => ctx.db.patch(wallets[1], { state: "ready" }));
    for (const change of [
      { units: "1000000" },
      { token: TESTNET_ASSETS.XLM },
      { amount: "1.00000001" },
      { recipientProfileId: undefined },
    ])
      await expect(
        sender.mutation(api.operations.prepare, { ...prepared, ...change }),
      ).rejects.toThrow();
    await t.run(async (ctx) => {
      const message = await ctx.db.query("messages").first();
      await ctx.db.patch(message!._id, { mentions: [] });
    });
    await expect(prepare()).rejects.toThrow(/Select your recipient/);
  });
  it("requires friendship and activated accounts again when claiming authorization", async () => {
    const { t, sender, review, friendship, wallets } = await setup();
    const id = await review();
    const submit = () =>
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      });
    await t.run((ctx) => ctx.db.patch(friendship, { state: "removed" }));
    await expect(submit()).rejects.toThrow(/accepted friend/);
    await t.run(async (ctx) => {
      await ctx.db.patch(friendship, { state: "accepted" });
      await ctx.db.patch(wallets[1], { account: "changed-account" });
    });
    await expect(submit()).rejects.toThrow(/accounts changed/);
    expect((await sender.query(api.operations.get, { id })).state).toBe(
      "awaiting_approval",
    );
  });
  it("fences edits and cancelled reviews against stale authorizations", async () => {
    const { sender, review } = await setup();
    const id = await review();
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "edit", amount: "2", units: "20000000" },
    });
    await expect(
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 2,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/Authorization/);
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 2,
      action: { kind: "cancel" },
    });
    await expect(
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 3,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/no longer/);
  });
  it.each(["USDC", "XLM"] as const)(
    "only announces a confirmed %s transfer once to the sender and recipient, including recipient reconciliation",
    async (asset) => {
      const { t, sender, recipient, review, wallets } = await setup(asset);
      const id = await review();
      const submit = () =>
        sender.mutation(api.operations.change, {
          key,
          id,
          revision: 1,
          action: { kind: "submit", reviewId: "review" },
        });
      expect(
        (await Promise.allSettled([submit(), submit()])).filter(
          (r) => r.status === "fulfilled",
        ),
      ).toHaveLength(1);
      expect(
        await recipient.query(api.operations.pendingIncomingCount, {}),
      ).toBe(1);
      const report = {
        kind: "report" as const,
        reviewId: "review",
        state: "confirmed" as const,
        hash: "a".repeat(64),
        error: null,
      };
      await expect(
        sender.mutation(api.operations.change, {
          key,
          id,
          revision: 1,
          action: report,
        }),
      ).rejects.toThrow(/evidence/);
      await t.mutation(api.sponsorship.claim, { key, id: "review" });
      await t.mutation(api.sponsorship.pending, {
        key,
        id: "review",
        hash: report.hash,
        envelope: "server-validated-signed-envelope",
      });
      await sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { ...report, state: "submitting" },
      });
      expect(
        (await recipient.query(api.notifications.current, {})).items,
      ).toHaveLength(0);
      expect(
        (await sender.query(api.conversations.current, {})).messages.filter(
          (row) => row.role === "assistant",
        ),
      ).toHaveLength(0);
      await expect(
        sender.mutation(api.operations.change, {
          key,
          id,
          revision: 1,
          action: { ...report, state: "failed" },
        }),
      ).rejects.toThrow(/pending/);
      await t.mutation(api.sponsorship.finish, {
        key,
        id: "review",
        expectedState: "pending",
        state: "confirmed",
        ledger: 123,
        error: null,
      });
      const balance = {
        balance: "100000000",
        balanceError: null,
        usdcBalance: "10000000",
        usdcBalanceError: null,
      };
      await recipient.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: {
          ...report,
          balances: {
            sender: { ...balance, account: "sender-account" },
            recipient: { ...balance, account: "recipient-account" },
          },
        },
      });
      await sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: report,
      });
      await sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { ...report, state: "submitting" },
      });
      expect((await sender.query(api.operations.get, { id })).state).toBe(
        "confirmed",
      );
      expect(
        (await recipient.query(api.notifications.current, {})).items,
      ).toHaveLength(1);
      const delivered = await t.run((ctx) =>
        ctx.db
          .query("messages")
          .filter((q) => q.eq(q.field("role"), "assistant"))
          .collect(),
      );
      expect(delivered).toHaveLength(2);
      expect(delivered.find((row) => row.event)?.event?.transfer).toMatchObject(
        {
          asset,
          amount: "1",
          hash: report.hash,
        },
      );
      expect(
        await t.run(async (ctx) =>
          (await Promise.all(wallets.map((id) => ctx.db.get(id)))).map(
            (row) => row?.usdcBalance,
          ),
        ),
      ).toEqual(["10000000", "10000000"]);
      expect(
        await recipient.query(api.operations.pendingIncomingCount, {}),
      ).toBe(0);
      const snapshot = await sender.query(api.conversations.current, {});
      const confirmations = snapshot.messages.filter(
        (row) => row.messageId === `transfer-confirmed-${id}`,
      );
      expect(confirmations).toHaveLength(1);
      expect(
        confirmations[0].message.parts.find((part) => part.type === "text"),
      ).toMatchObject({
        type: "text",
        text: `Done — 1 ${asset} sent to @recipient.`,
      });
      expect(
        confirmations[0].message.parts.find(
          (part) => part.type === "tool-readBalance",
        ),
      ).toMatchObject({
        state: "output-available",
        output: { active: true, amount: "10", usdcAmount: "1" },
      });
    },
  );
  it("keeps unknown submissions non-retryable and requires new review after definitive failure", async () => {
    const { t, sender, review } = await setup();
    const id = await review();
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "submit", reviewId: "review" },
    });
    await expect(
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "retry" },
      }),
    ).rejects.toThrow();
    await t.mutation(api.sponsorship.finish, {
      key,
      id: "review",
      expectedState: "review",
      state: "failed",
      ledger: null,
      error: "Authorization interrupted before sending",
    });
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: {
        kind: "report",
        reviewId: "review",
        state: "failed",
        hash: null,
        error: "Not sent",
      },
    });
    expect(
      (await sender.query(api.conversations.current, {})).messages.filter(
        (row) => row.role === "assistant",
      ),
    ).toHaveLength(0);
    await sender.mutation(api.operations.change, {
      key,
      id,
      revision: 1,
      action: { kind: "retry" },
    });
    expect(await sender.query(api.operations.get, { id })).toMatchObject({
      revision: 2,
      state: "awaiting_approval",
      reviewId: null,
    });
    await expect(
      sender.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow(/changed/);
  });
  it("never exposes an outgoing operation or authorizes it as the recipient or an unrelated user", async () => {
    const { t, sender, recipient, review } = await setup();
    const id = await review();
    await expect(recipient.query(api.operations.get, { id })).rejects.toThrow();
    await expect(
      recipient.mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: { kind: "submit", reviewId: "review" },
      }),
    ).rejects.toThrow();
    await expect(
      sender.mutation(api.operations.change, {
        key: "wrong",
        id,
        revision: 1,
        action: { kind: "cancel" },
      }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: "stranger" }).mutation(api.operations.change, {
        key,
        id,
        revision: 1,
        action: {
          kind: "report",
          reviewId: "review",
          state: "confirmed",
          hash: "a".repeat(64),
          error: null,
        },
      }),
    ).rejects.toThrow();
  });
});
