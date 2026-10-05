/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const outsider = t.withIdentity({ subject: "outsider" });
  const { profiles, friendship } = await t.run(async (ctx) => {
    const profiles = [];
    for (const user of ["alice", "bob", "outsider"]) {
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
    }
    const [low, high] = [profiles[0], profiles[1]].sort();
    const friendship = await ctx.db.insert("friendships", {
      low,
      high,
      initiator: profiles[0],
      state: "accepted",
      generation: 1,
      updatedAt: Date.now(),
    });
    return { profiles, friendship };
  });
  const conversationId = await alice.mutation(api.directMessages.start, {
    friendId: profiles[1],
  });
  return { t, alice, bob, outsider, profiles, friendship, conversationId };
}

const paginationOpts = { numItems: 20, cursor: null };

describe("friend text messages", () => {
  it("reuses the pair in both directions and persists server-derived authors without wallets or AI side effects", async () => {
    const { t, alice, bob, profiles, conversationId } = await setup();
    const ids = await Promise.all([
      alice.mutation(api.directMessages.start, { friendId: profiles[1] }),
      bob.mutation(api.directMessages.start, { friendId: profiles[0] }),
    ]);
    expect(ids).toEqual([conversationId, conversationId]);
    await alice.mutation(api.directMessages.send, {
      conversationId,
      clientId: "hello",
      text: "Hello Bob",
    });
    await bob.mutation(api.directMessages.send, {
      conversationId,
      clientId: "hello",
      text: "Hi Alice",
    });
    // A new authenticated client reads only durable database state, like a reload.
    const reloaded = t.withIdentity({ subject: "alice" });
    const page = await reloaded.query(api.directMessages.history, {
      conversationId,
      paginationOpts,
    });
    expect(
      page.page.map((m) => [
        m.sequence,
        m.text,
        m.author.profileId,
        m.author.kind,
      ]),
    ).toEqual([
      [2, "Hi Alice", profiles[1], "human"],
      [1, "Hello Bob", profiles[0], "human"],
    ]);
    expect(
      (await bob.query(api.directMessages.inbox, {})).conversations[0],
    ).toMatchObject({
      preview: "Hi Alice",
      fromMe: true,
      unread: 1,
    });
    const isolated = await t.run(async (ctx) => ({
      privateConversations: await ctx.db.query("conversations").collect(),
      privateMessages: await ctx.db.query("messages").collect(),
      wallets: await ctx.db.query("payments").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(isolated).toEqual({
      privateConversations: [],
      privateMessages: [],
      wallets: [],
      scheduled: [],
    });
  });

  it("serializes simultaneous starts from a previously unopened friend pair", async () => {
    const { t, alice, bob, profiles, conversationId } = await setup();
    await t.run(async (ctx) => {
      for (const member of await ctx.db.query("directMembers").collect())
        await ctx.db.delete(member._id);
      await ctx.db.delete(conversationId);
    });
    const [a, b] = await Promise.all([
      alice.mutation(api.directMessages.start, { friendId: profiles[1] }),
      bob.mutation(api.directMessages.start, { friendId: profiles[0] }),
    ]);
    expect(a).toBe(b);
    expect(
      await t.run((ctx) => ctx.db.query("directMembers").collect()),
    ).toHaveLength(2);
  });

  it("deduplicates concurrent retries and rejects reusing a key for altered text", async () => {
    const { t, alice, bob, conversationId } = await setup();
    const args = { conversationId, clientId: "retry", text: "Only once" };
    const [a, b] = await Promise.all([
      alice.mutation(api.directMessages.send, args),
      alice.mutation(api.directMessages.send, args),
    ]);
    expect(a).toBe(b);
    await expect(
      alice.mutation(api.directMessages.send, { ...args, text: "Changed" }),
    ).rejects.toThrow(/different message/);
    expect(
      (await bob.query(api.directMessages.detail, { conversationId })).unread,
    ).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.query("directMessages").collect()),
    ).toHaveLength(1);
  });

  it("paginates in sequence order without gaps while new messages arrive", async () => {
    const { alice, bob, conversationId } = await setup();
    for (let i = 0; i < 12; i++)
      await (i % 2 ? bob : alice).mutation(api.directMessages.send, {
        conversationId,
        clientId: `m${i}`,
        text: `Message ${i}`,
      });
    const first = await alice.query(api.directMessages.history, {
      conversationId,
      paginationOpts: { numItems: 5, cursor: null },
    });
    await bob.mutation(api.directMessages.send, {
      conversationId,
      clientId: "new",
      text: "Arriving during pagination",
    });
    const second = await alice.query(api.directMessages.history, {
      conversationId,
      paginationOpts: { numItems: 5, cursor: first.continueCursor },
    });
    const third = await alice.query(api.directMessages.history, {
      conversationId,
      paginationOpts: { numItems: 5, cursor: second.continueCursor },
    });
    expect(
      [...first.page, ...second.page, ...third.page].map((m) => m.sequence),
    ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(third.isDone).toBe(true);
    expect(
      (
        await alice.query(api.directMessages.history, {
          conversationId,
          paginationOpts,
        })
      ).page[0].sequence,
    ).toBe(13);
  });

  it("tracks each participant independently and fences stale/partial read acknowledgements", async () => {
    const { alice, bob, conversationId } = await setup();
    const send = (clientId: string) =>
      alice.mutation(api.directMessages.send, {
        conversationId,
        clientId,
        text: clientId,
      });
    await send("one");
    await bob.mutation(api.directMessages.send, {
      conversationId,
      clientId: "reply",
      text: "Reply",
    });
    await send("two");
    await bob.mutation(api.directMessages.markRead, {
      conversationId,
      throughSequence: 1,
    });
    expect(
      (await bob.query(api.directMessages.detail, { conversationId })).unread,
    ).toBe(1);
    expect(
      (await alice.query(api.directMessages.detail, { conversationId })).unread,
    ).toBe(1);
    await bob.mutation(api.directMessages.markRead, {
      conversationId,
      throughSequence: 3,
    });
    await bob.mutation(api.directMessages.markRead, {
      conversationId,
      throughSequence: 1,
    });
    await send("three");
    expect(
      (await bob.query(api.directMessages.inbox, {})).conversations[0].unread,
    ).toBe(1);
    await expect(
      bob.mutation(api.directMessages.markRead, {
        conversationId,
        throughSequence: 100,
      }),
    ).rejects.toThrow(/read position/);
    expect(
      (await bob.query(api.directMessages.detail, { conversationId }))
        .readSequence,
    ).toBe(3);
  });

  it("rejects unauthorized reads/writes and unauthenticated access", async () => {
    const { t, outsider, conversationId, profiles } = await setup();
    for (const client of [t, outsider]) {
      await expect(
        client.query(api.directMessages.detail, { conversationId }),
      ).rejects.toThrow();
      await expect(
        client.query(api.directMessages.history, {
          conversationId,
          paginationOpts,
        }),
      ).rejects.toThrow();
      await expect(
        client.mutation(api.directMessages.send, {
          conversationId,
          clientId: "bad",
          text: "Sneak in",
        }),
      ).rejects.toThrow();
      await expect(
        client.mutation(api.directMessages.markRead, {
          conversationId,
          throughSequence: 0,
        }),
      ).rejects.toThrow();
    }
    expect(
      (await outsider.query(api.directMessages.inbox, {})).conversations,
    ).toEqual([]);
    await expect(t.query(api.directMessages.inbox, {})).rejects.toThrow(
      /Sign in/,
    );
    await expect(
      outsider.mutation(api.directMessages.start, { friendId: profiles[0] }),
    ).rejects.toThrow(/accepted friend/);
  });

  it("retains history after removal but blocks new messages, including after a pending re-invitation", async () => {
    const { t, alice, bob, friendship, conversationId, profiles } =
      await setup();
    const args = {
      conversationId,
      clientId: "saved",
      text: "Keep this history",
    };
    const id = await alice.mutation(api.directMessages.send, args);
    await alice.mutation(api.social.friendAction, {
      personId: profiles[1],
      action: "remove",
    });
    for (const client of [alice, bob]) {
      expect(
        (
          await client.query(api.directMessages.history, {
            conversationId,
            paginationOpts,
          })
        ).page[0].text,
      ).toBe(args.text);
      expect(
        (await client.query(api.directMessages.detail, { conversationId }))
          .canSend,
      ).toBe(false);
      await expect(
        client.mutation(api.directMessages.send, { ...args, clientId: "new" }),
      ).rejects.toThrow(/accepted friend/);
    }
    expect(await alice.mutation(api.directMessages.send, args)).toBe(id);
    await bob.mutation(api.directMessages.markRead, {
      conversationId,
      throughSequence: 1,
    });
    await t.run((ctx) => ctx.db.patch(friendship, { state: "pending" }));
    await expect(
      alice.mutation(api.directMessages.send, { ...args, clientId: "pending" }),
    ).rejects.toThrow(/accepted friend/);
    await t.run((ctx) => ctx.db.patch(friendship, { state: "accepted" }));
    expect(
      await bob.mutation(api.directMessages.start, { friendId: profiles[0] }),
    ).toBe(conversationId);
    await bob.mutation(api.directMessages.send, {
      ...args,
      clientId: "restored",
    });
    expect(
      (
        await alice.query(api.directMessages.history, {
          conversationId,
          paginationOpts,
        })
      ).page,
    ).toHaveLength(2);
  });

  it("validates text and rate-limits new sends without charging retries", async () => {
    const { alice, bob, conversationId } = await setup();
    for (const text of ["", " \n\t", "a".repeat(4001)])
      await expect(
        alice.mutation(api.directMessages.send, {
          conversationId,
          clientId: "invalid",
          text,
        }),
      ).rejects.toThrow(/4,000/);
    const args = { conversationId, clientId: "limit0", text: "a".repeat(4000) };
    await alice.mutation(api.directMessages.send, args);
    for (let i = 1; i < 30; i++)
      await alice.mutation(api.directMessages.send, {
        conversationId,
        clientId: `limit${i}`,
        text: "Hello",
      });
    await expect(
      alice.mutation(api.directMessages.send, {
        conversationId,
        clientId: "over",
        text: "Too many",
      }),
    ).rejects.toThrow(/pause/);
    await alice.mutation(api.directMessages.send, args);
    expect(
      (await bob.query(api.directMessages.detail, { conversationId })).unread,
    ).toBe(30);
  });
});
