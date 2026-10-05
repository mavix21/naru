/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import { NARU_SPLIT, TESTNET_ASSETS } from "../convex/money";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "split-tests-server-key-32-characters";
beforeEach(() => {
  process.env.NARU_PAYMENTS_KEY = key;
});
const accounts = [TESTNET_ASSETS.XLM, TESTNET_ASSETS.USDC, NARU_SPLIT.contract];

async function setup() {
  const t = convexTest(schema, modules);
  const organizer = t.withIdentity({ subject: "organizer" });
  const ana = t.withIdentity({ subject: "ana" });
  const josh = t.withIdentity({ subject: "josh" });
  const outsider = t.withIdentity({ subject: "outsider" });
  const { people, wallets, friendships } = await t.run(async (ctx) => {
    const people = [];
    const wallets = [];
    for (const [i, user] of [
      "organizer",
      "ana",
      "josh",
      "outsider",
    ].entries()) {
      people.push(
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
        name: `${user} Naru`,
        accent: "sky",
        paymentChoiceMade: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      wallets.push(
        await ctx.db.insert("payments", {
          clerkUserId: user,
          device: "test",
          attempt: "test",
          started: true,
          account: accounts[i] ?? null,
          credentialId: "verified-credential",
          publicKey: "verified-key",
          deployment: null,
          candidate: null,
          challenge: null,
          expires: null,
          state: "ready",
          balance: "0",
          balanceError: null,
          job: null,
          updatedAt: Date.now(),
        }),
      );
    }
    const friendships = [];
    for (const participant of people.slice(1, 3)) {
      const [low, high] = [people[0], participant].sort();
      friendships.push(
        await ctx.db.insert("friendships", {
          low,
          high,
          initiator: people[0],
          state: "accepted",
          generation: 1,
          updatedAt: Date.now(),
        }),
      );
    }
    const conversation = await ctx.db.insert("conversations", {
      clerkUserId: "organizer",
      sequence: 1,
      activeTurn: "turn",
      activeUntil: Date.now() + 120000,
      error: null,
    });
    await ctx.db.insert("messages", {
      conversationId: conversation,
      messageId: "turn",
      role: "user",
      sequence: 1,
      agentMessageIds: [],
      mentions: people
        .slice(1, 3)
        .map((userId) => ({ userId, start: 0, end: 4, label: "@ana" })),
    });
    return { people, wallets, friendships };
  });
  const fields = {
    title: "Dinner",
    total: "12.0000001",
    participantIds: people.slice(1, 3),
    includeSelf: true,
    mode: "reimburse" as const,
  };
  const prepare = () =>
    organizer.mutation(api.splits.prepare, {
      key,
      messageId: "turn",
      token: TESTNET_ASSETS.USDC,
      asset: "USDC",
      creationId: "ab".repeat(32),
      ...fields,
    });
  const bind = async () => {
    const id = await prepare();
    await t.mutation(api.sponsorship.insert, {
      key,
      id: "review",
      account: accounts[0],
      kind: "split_create",
      func: "validated-by-server-policy",
      auth: "validated-by-server-policy",
      expires: Date.now() + 120000,
    });
    await organizer.mutation(api.splits.bindCreation, {
      key,
      id,
      revision: 1,
      reviewId: "review",
    });
    return id;
  };
  const claim = async () => {
    const id = await bind();
    await organizer.mutation(api.splits.claimCreation, {
      key,
      id,
      revision: 1,
      reviewId: "review",
    });
    return id;
  };
  const confirmJob = async () => {
    await t.mutation(api.sponsorship.claim, { key, id: "review" });
    await t.mutation(api.sponsorship.pending, {
      key,
      id: "review",
      hash: "cd".repeat(32),
      envelope: "verified-signed-envelope",
    });
    await t.mutation(api.sponsorship.finish, {
      key,
      id: "review",
      expectedState: "pending",
      state: "confirmed",
      ledger: 100,
      error: null,
    });
  };
  const shareStates = accounts
    .slice(1)
    .map((account) => ({ account, state: "outstanding" as const }));
  return {
    t,
    organizer,
    ana,
    josh,
    outsider,
    people,
    wallets,
    friendships,
    fields,
    prepare,
    bind,
    claim,
    confirmJob,
    shareStates,
  };
}

describe("USDC split publication", () => {
  it("serializes maintenance for published records and denies untrusted or unpublished maintenance", async () => {
    vi.useFakeTimers();
    try {
      const { t, organizer, claim, confirmJob, shareStates } = await setup();
      const id = await claim();
      for (const reviewId of ["maintenance-a", "maintenance-b"])
        await t.mutation(api.sponsorship.insert, {
          key,
          id: reviewId,
          account: accounts[0],
          kind: "split_keep_alive",
          func: "server-validated-keep-alive",
          auth: "[]",
          expires: Date.now() + 180000,
        });
      await expect(
        t.mutation(api.splits.bindMaintenance, {
          key,
          id,
          reviewId: "maintenance-a",
        }),
      ).rejects.toThrow(/unavailable/);
      await confirmJob();
      await organizer.mutation(api.splits.reportCreation, {
        key,
        id,
        revision: 1,
        reviewId: "review",
        verifiedLedger: 100,
        shareStates,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await expect(
        t.mutation(api.splits.bindMaintenance, {
          key: "untrusted",
          id,
          reviewId: "maintenance-a",
        }),
      ).rejects.toThrow();
      expect(
        await t.mutation(api.splits.bindMaintenance, {
          key,
          id,
          reviewId: "maintenance-a",
        }),
      ).toBe("maintenance-a");
      await t.mutation(api.sponsorship.claim, { key, id: "maintenance-a" });
      expect(
        await t.mutation(api.splits.bindMaintenance, {
          key,
          id,
          reviewId: "maintenance-b",
        }),
      ).toBe("maintenance-a");
      expect(
        (await organizer.query(api.splits.get, { id })).split
          .maintenanceReviewId,
      ).toBe("maintenance-a");
      await t.mutation(api.sponsorship.finish, {
        key,
        id: "maintenance-a",
        expectedState: "preparing",
        state: "failed",
        ledger: null,
        error: "No transaction sent",
      });
      expect(
        await t.mutation(api.splits.bindMaintenance, {
          key,
          id,
          reviewId: "maintenance-b",
        }),
      ).toBe("maintenance-b");
      expect(
        (await organizer.query(api.splits.get, { id })).requests,
      ).toHaveLength(2);
      await expect(
        t.query(api.splits.maintenanceCandidates, {
          key: "untrusted",
          paginationOpts: { cursor: null, numItems: 10 },
        }),
      ).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it("extends preparation idempotently, includes the organizer, and publishes nothing without a passkey", async () => {
    const { t, organizer, prepare } = await setup();
    const id = await prepare();
    expect(await prepare()).toBe(id);
    const { split } = await organizer.query(api.splits.get, { id });
    expect(
      split.shares.reduce((sum, s) => sum + BigInt(s.units), BigInt(0)),
    ).toBe(BigInt(120000001));
    expect(
      split.shares.filter((s) => s.person.userId === split.organizer.userId),
    ).toHaveLength(1);
    await expect(
      organizer.mutation(api.splits.confirm, { id, revision: 1 }),
    ).rejects.toThrow(/passkey/);
    expect(
      await t.run((ctx) => ctx.db.query("paymentRequests").collect()),
    ).toHaveLength(0);
  });
  it("rejects unauthorized publication/access and requires accepted friends and active accounts", async () => {
    const {
      t,
      organizer,
      outsider,
      ana,
      prepare,
      fields,
      wallets,
      friendships,
    } = await setup();
    await t.run((ctx) => ctx.db.patch(wallets[1], { state: "pending" }));
    await expect(prepare()).rejects.toThrow(/activate/);
    await t.run(async (ctx) => {
      await ctx.db.patch(wallets[1], { state: "ready" });
      await ctx.db.patch(friendships[0], { state: "pending" });
    });
    await expect(prepare()).rejects.toThrow(/accepted friend/);
    await t.run((ctx) => ctx.db.patch(friendships[0], { state: "accepted" }));
    const id = await prepare();
    for (const actor of [outsider, ana]) {
      await expect(actor.query(api.splits.get, { id })).rejects.toThrow();
      await expect(
        actor.query(api.splits.publication, { key, id }),
      ).rejects.toThrow();
      await expect(
        actor.mutation(api.splits.claimCreation, {
          key,
          id,
          revision: 1,
          reviewId: "review",
        }),
      ).rejects.toThrow();
      await expect(
        actor.mutation(api.splits.edit, { id, revision: 1, ...fields }),
      ).rejects.toThrow();
    }
    await expect(
      organizer.mutation(api.splits.claimCreation, {
        key: "wrong",
        id,
        revision: 1,
        reviewId: "review",
      }),
    ).rejects.toThrow();
  });
  it("invalidates old authorization on edits, including description-only edits", async () => {
    const { t, organizer, bind, fields } = await setup();
    const id = await bind();
    const before = await organizer.query(api.splits.get, { id });
    await organizer.mutation(api.splits.edit, {
      id,
      revision: 1,
      ...fields,
      title: "Lunch",
    });
    await expect(
      organizer.mutation(api.splits.claimCreation, {
        key,
        id,
        revision: 1,
        reviewId: "review",
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      t.mutation(api.sponsorship.claim, { key, id: "review" }),
    ).resolves.toBe(false);
    const after = await organizer.query(api.splits.get, { id });
    expect(after.split.creation?.id).toBe(before.split.creation?.id);
    expect(after.split.creation?.reviewId).toBeUndefined();
  });
  it("rechecks accounts/friendship at the authorization claim and blocks edits while pending", async () => {
    const { t, organizer, bind, fields, wallets } = await setup();
    const id = await bind();
    await t.run((ctx) => ctx.db.patch(wallets[1], { account: accounts[2] }));
    await expect(
      organizer.mutation(api.splits.claimCreation, {
        key,
        id,
        revision: 1,
        reviewId: "review",
      }),
    ).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch(wallets[1], { account: accounts[1] }));
    await organizer.mutation(api.splits.claimCreation, {
      key,
      id,
      revision: 1,
      reviewId: "review",
    });
    await expect(
      organizer.mutation(api.splits.edit, { id, revision: 1, ...fields }),
    ).rejects.toThrow();
    await expect(
      organizer.mutation(api.splits.claimCreation, {
        key,
        id,
        revision: 1,
        reviewId: "review",
      }),
    ).resolves.toBe(false);
  });
  it("delivers nothing for pending/failed transactions and retains the creation ID for a fresh authorization", async () => {
    const { t, organizer, claim } = await setup();
    const id = await claim();
    await t.mutation(api.sponsorship.claim, { key, id: "review" });
    await t.mutation(api.sponsorship.pending, {
      key,
      id: "review",
      hash: "ef".repeat(32),
      envelope: "persisted-ambiguous-envelope",
    });
    await organizer.mutation(api.splits.reportCreation, {
      key,
      id,
      revision: 1,
      reviewId: "review",
    });
    expect(
      await t.run((ctx) => ctx.db.query("directMessages").collect()),
    ).toHaveLength(0);
    await expect(
      t.mutation(internal.splits.deliverPublished, { id }),
    ).rejects.toThrow(/not verified/);
    await t.mutation(api.sponsorship.finish, {
      key,
      id: "review",
      expectedState: "pending",
      state: "failed",
      ledger: 100,
      error: "On-chain creation failed",
    });
    await organizer.mutation(api.splits.reportCreation, {
      key,
      id,
      revision: 1,
      reviewId: "review",
    });
    const { split } = await organizer.query(api.splits.get, { id });
    expect(split.state).toBe("draft");
    expect(split.creation?.id).toBe("ab".repeat(32));
    expect(split.revision).toBe(2);
    expect(
      await t.run((ctx) => ctx.db.query("paymentRequests").collect()),
    ).toHaveLength(0);
  });
  it("recovers confirmation-before-delivery, reuses the pair DM, deduplicates retries, and restricts request projections", async () => {
    vi.useFakeTimers();
    try {
      const {
        t,
        organizer,
        ana,
        josh,
        outsider,
        people,
        claim,
        confirmJob,
        shareStates,
      } = await setup();
      const existingDM = await organizer.mutation(api.directMessages.start, {
        friendId: people[1],
      });
      const id = await claim();
      await confirmJob();
      await expect(
        organizer.mutation(api.splits.reportCreation, {
          key,
          id,
          revision: 1,
          reviewId: "review",
        }),
      ).rejects.toThrow(/verified/);
      expect(
        await t.run((ctx) => ctx.db.query("directMessages").collect()),
      ).toHaveLength(0);
      // Resume after the HTTP worker was lost following successful confirmation.
      await organizer.mutation(api.splits.reportCreation, {
        key,
        id,
        revision: 1,
        reviewId: "review",
        verifiedLedger: 100,
        shareStates,
      });
      expect((await organizer.query(api.splits.get, { id })).split.state).toBe(
        "published",
      );
      // Simulate an interrupted delivery worker and then a durable retry.
      await t.run(async (ctx) => {
        const member = await ctx.db
          .query("directMembers")
          .withIndex("by_conversation_participant", (q) =>
            q
              .eq("conversationId", existingDM)
              .eq("participant.profileId", people[1]),
          )
          .unique();
        await ctx.db.delete(member!._id);
      });
      await expect(
        t.mutation(internal.splits.deliverPublished, { id }),
      ).rejects.toThrow(/unavailable/);
      expect(
        await t.run((ctx) => ctx.db.query("paymentRequests").collect()),
      ).toHaveLength(0);
      await t.run((ctx) =>
        ctx.db.insert("directMembers", {
          conversationId: existingDM,
          participant: { kind: "human", profileId: people[1] },
          receivedCount: 0,
          readCount: 0,
          readSequence: 0,
          updatedAt: Date.now(),
        }),
      );
      await t.mutation(internal.splits.deliverPublished, { id });
      await t.mutation(internal.splits.deliverPublished, { id });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const requests = await t.run((ctx) =>
        ctx.db.query("paymentRequests").collect(),
      );
      const messages = await t.run((ctx) =>
        ctx.db.query("directMessages").collect(),
      );
      expect(requests).toHaveLength(2);
      expect(messages).toHaveLength(2);
      expect(
        messages.every(
          (m) =>
            m.kind === "split_request" &&
            m.author.kind === "naru_request" &&
            m.text === "",
        ),
      ).toBe(true);
      expect(
        messages.find((m) => m.recipientId === people[1])?.conversationId,
      ).toBe(existingDM);
      expect(
        (await ana.query(api.directMessages.inbox, {})).conversations[0].unread,
      ).toBe(1);
      expect(
        (await josh.query(api.directMessages.inbox, {})).conversations[0]
          .unread,
      ).toBe(1);
      expect(
        (
          await organizer.query(api.directMessages.inbox, {})
        ).conversations.every((c) => c.unread === 0),
      ).toBe(true);
      expect(
        await t.run((ctx) => ctx.db.query("notifications").collect()),
      ).toHaveLength(0);
      expect(
        (await t.run((ctx) => ctx.db.query("messages").collect())).every(
          (m) => m.messageId === "turn" || m.event?.kind === "split_review",
        ),
      ).toBe(true);
      const anaRequest = requests.find((r) => r.participantId === people[1])!;
      const projection = await ana.query(api.directMessages.requestCard, {
        id: anaRequest._id,
      });
      expect(Object.keys(projection).sort()).toEqual([
        "amount",
        "asset",
        "creationHash",
        "description",
        "organizer",
        "state",
      ]);
      for (const actor of [outsider, josh])
        await expect(
          actor.query(api.directMessages.requestCard, { id: anaRequest._id }),
        ).rejects.toThrow();
      await expect(
        ana.query(api.splits.request, { id: anaRequest._id }),
      ).rejects.toThrow(/read-only/);
      await expect(
        ana.mutation(api.operations.prepareRequest, {
          key,
          requestId: anaRequest._id,
          token: TESTNET_ASSETS.USDC,
        }),
      ).rejects.toThrow(/read-only/);
      await expect(
        organizer.mutation(api.splits.requestAction, {
          id: anaRequest._id,
          action: "cancel",
        }),
      ).rejects.toThrow(/read-only/);
      await ana.mutation(api.directMessages.markRead, {
        conversationId: existingDM,
        throughSequence: 1,
      });
      await t.mutation(internal.splits.deliverPublished, { id });
      expect(
        (await ana.query(api.directMessages.inbox, {})).conversations[0].unread,
      ).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
