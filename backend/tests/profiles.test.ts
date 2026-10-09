/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "profile-tests-server-key-0123456789";

beforeEach(() => vi.stubEnv("NARU_PAYMENTS_KEY", key));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  for (const clerkUserId of ["alice", "bob"])
    await t.mutation(api.profiles.seedIdentity, {
      key,
      clerkUserId,
      suggestedName: `${clerkUserId} Google`,
    });
  return t;
}

async function claim(
  t: Awaited<ReturnType<typeof setup>>,
  clerkUserId: string,
  username: string,
) {
  const prepared = await t.mutation(api.profiles.prepareUsername, {
    key,
    clerkUserId,
    username,
  });
  if (prepared.claimId)
    await t.mutation(api.profiles.finishUsername, {
      key,
      clerkUserId,
      ...prepared,
      claimId: prepared.claimId,
    });
  return prepared;
}

describe("authoritative public profile identity", () => {
  it("normalizes claims and immediately makes profiles anonymously readable before wallet or companion setup", async () => {
    const t = await setup();
    await claim(t, "alice", "  Alice_123  ");
    const publicProfile = await t.query(api.profiles.publicByUsername, {
      username: "ALICE_123",
    });
    expect(publicProfile).toEqual({
      username: "alice_123",
      displayName: "alice Google",
      bio: "",
      companion: { name: "Naru", accent: "sky" },
    });
    expect(
      await t.query(api.profiles.publicByUsername, { username: "unknown" }),
    ).toBeNull();
    expect(
      await t.query(api.profiles.publicByUsername, {
        username: "alice/../bob",
      }),
    ).toBeNull();
  });

  it("allows exactly one concurrent case-insensitive reservation and cannot overwrite its owner", async () => {
    const t = await setup();
    const results = await Promise.allSettled([
      t.mutation(api.profiles.prepareUsername, {
        key,
        clerkUserId: "alice",
        username: "Same_Name",
      }),
      t.mutation(api.profiles.prepareUsername, {
        key,
        clerkUserId: "bob",
        username: "same_name",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const reservations = await t.run((ctx) =>
      ctx.db.query("usernameClaims").collect(),
    );
    const winner = reservations[0];
    await t.mutation(api.profiles.finishUsername, {
      key,
      clerkUserId: winner.clerkUserId,
      claimId: winner._id,
      username: winner.username,
    });
    await expect(
      t.mutation(api.profiles.prepareUsername, {
        key,
        clerkUserId: winner.clerkUserId === "alice" ? "bob" : "alice",
        username: "SAME_NAME",
      }),
    ).rejects.toThrow(/taken/);
  });

  it.each([
    "admin",
    "NaRu",
    "support",
    "ab",
    "4alice",
    "alice.name",
    "alice@example.com",
    "аlice",
    "a".repeat(25),
  ])("rejects reserved or invalid new handle %s", async (username) => {
    const t = await setup();
    await expect(claim(t, "alice", username)).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("usernameClaims").collect()),
    ).toEqual([]);
  });

  it("keeps existing valid and legacy-reserved handles through changed Clerk suggestions", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const alice = await ctx.db
        .query("profiles")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "alice"))
        .unique();
      await ctx.db.patch(alice!._id, { username: "support" });
    });
    expect(await claim(t, "alice", "replacement")).toEqual({
      username: "support",
      claimId: null,
    });
    expect(
      await t.query(api.profiles.publicByUsername, { username: "support" }),
    ).not.toBeNull();
    expect(
      await t.query(api.profiles.publicByUsername, { username: "replacement" }),
    ).toBeNull();
  });

  it("resumes the same reservation after failures and ignores late release/commit attempts", async () => {
    const t = await setup();
    const first = await t.mutation(api.profiles.prepareUsername, {
      key,
      clerkUserId: "alice",
      username: "first_name",
    });
    const retry = await t.mutation(api.profiles.prepareUsername, {
      key,
      clerkUserId: "alice",
      username: "second_name",
    });
    expect(retry).toEqual(first);
    await t.mutation(api.profiles.releaseUsername, {
      key,
      clerkUserId: "bob",
      claimId: first.claimId!,
    });
    await expect(claim(t, "bob", "first_name")).rejects.toThrow(/taken/);
    await t.mutation(api.profiles.releaseUsername, {
      key,
      clerkUserId: "alice",
      claimId: first.claimId!,
    });
    const second = await claim(t, "alice", "second_name");
    await expect(
      t.mutation(api.profiles.finishUsername, {
        key,
        clerkUserId: "alice",
        claimId: first.claimId!,
        username: first.username,
      }),
    ).rejects.toThrow(/changed/);
    await t.mutation(api.profiles.finishUsername, {
      key,
      clerkUserId: "alice",
      claimId: second.claimId!,
      username: second.username,
    });
    expect(
      (
        await t
          .withIdentity({ subject: "alice" })
          .query(api.profiles.current, {})
      )?.username,
    ).toBe("second_name");
  });

  it("allows owner edits, preserves them on later sync, and publishes only the explicit projection", async () => {
    const t = await setup();
    const alice = t.withIdentity({
      subject: "alice",
      email: "private@example.com",
    });
    await claim(t, "alice", "alice_public");
    await alice.mutation(api.companions.save, { name: "Pip", accent: "coral" });
    await alice.mutation(api.profiles.updatePublic, {
      displayName: "  Chosen name  ",
      bio: "  Hello <script>alert(1)</script>  ",
    });
    await alice.mutation(api.profiles.updatePreference, {
      preferredGreeting: "SECRET GREETING",
    });
    await t.mutation(api.profiles.seedIdentity, {
      key,
      clerkUserId: "alice",
      suggestedName: "New Google Name",
    });
    const profile = await t.query(api.profiles.publicByUsername, {
      username: "alice_public",
    });
    expect(profile).toEqual({
      username: "alice_public",
      displayName: "Chosen name",
      bio: "Hello <script>alert(1)</script>",
      companion: { name: "Pip", accent: "coral" },
    });
    expect(JSON.stringify(profile)).not.toMatch(
      /clerkUserId|alice"|_id|preferredGreeting|SECRET|private@example.com|paymentChoiceMade|createdAt/,
    );
    await t
      .withIdentity({ subject: "bob" })
      .mutation(api.profiles.updatePublic, {
        displayName: "Bob edited",
        bio: "Bob only",
      });
    expect(
      (
        await t.query(api.profiles.publicByUsername, {
          username: "alice_public",
        })
      )?.displayName,
    ).toBe("Chosen name");
    await expect(
      t.mutation(api.profiles.updatePublic, {
        displayName: "Intruder",
        bio: "",
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.profiles.current, {})).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
    await expect(t.query(api.payments.current, {})).rejects.toThrow();
    await expect(t.query(api.conversations.current, {})).rejects.toThrow();
    await expect(t.query(api.social.current, {})).rejects.toThrow();
    await expect(t.query(api.operations.recent, {})).rejects.toThrow();
  });

  it("rejects unauthenticated synchronization and invalid owner text at the server", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.profiles.prepareUsername, {
        key: "fake",
        clerkUserId: "alice",
        username: "stolen",
      }),
    ).rejects.toThrow(/Trusted server/);
    const alice = t.withIdentity({ subject: "alice" });
    for (const args of [
      { displayName: "", bio: "" },
      { displayName: "a".repeat(61), bio: "" },
      { displayName: "Name\u202e", bio: "" },
      { displayName: "Name", bio: "a".repeat(161) },
    ])
      await expect(
        alice.mutation(api.profiles.updatePublic, args),
      ).rejects.toThrow();
  });

  it("requires a new user's username before finishing onboarding but preserves legacy access", async () => {
    const t = await setup();
    const alice = t.withIdentity({ subject: "alice" });
    await alice.mutation(api.companions.save, {
      name: "Pip",
      accent: "sunshine",
    });
    expect(
      (await alice.query(api.profiles.current, {}))?.onboardingStatus,
    ).toBe("incomplete");
    await expect(
      alice.mutation(api.companions.finishPaymentPrompt, {}),
    ).rejects.toThrow(/username/);
    await claim(t, "alice", "alice_new");
    await alice.mutation(api.companions.finishPaymentPrompt, {});
    expect(
      (await alice.query(api.profiles.current, {}))?.onboardingStatus,
    ).toBe("complete");
    const bob = t.withIdentity({ subject: "bob" });
    await bob.mutation(api.companions.save, {
      name: "Legacy Naru",
      accent: "sky",
    });
    await t.run(async (ctx) => {
      const legacy = await ctx.db
        .query("profiles")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "bob"))
        .unique();
      await ctx.db.patch(legacy!._id, { onboardingStatus: "complete" });
    });
    await bob.mutation(api.companions.finishPaymentPrompt, {});
    expect(
      (await bob.query(api.companions.current, {}))?.paymentChoiceMade,
    ).toBe(true);
  });
});
