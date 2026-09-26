import { ConvexError, v } from "convex/values";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const attemptPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const devicePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const accountPattern = /^C[A-Z2-7]{55}$/;

const credentialPattern = /^[A-Za-z0-9_-]{22,683}$/;

const publicKeyPattern = /^04[0-9a-f]{128}$/;

const base64urlAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array) {
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;

    encoded += base64urlAlphabet[first >> 2] ?? "";
    encoded += base64urlAlphabet[((first & 0x03) << 4) | (second >> 4)] ?? "";

    if (index + 1 < bytes.length)
      encoded += base64urlAlphabet[((second & 0x0f) << 2) | (third >> 6)] ?? "";

    if (index + 2 < bytes.length)
      encoded += base64urlAlphabet[third & 0x3f] ?? "";
  }

  return encoded;
}

function uuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

async function clerkUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw new ConvexError("UNAUTHENTICATED");

  return identity.subject;
}

function findPayment(ctx: QueryCtx | MutationCtx, clerkUserId: string) {
  return ctx.db
    .query("payments")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

// The Next.js payment route is the only verified writer. It holds this
// server-side key; the browser never receives it, so a client cannot claim an
// account without the WebAuthn proof that the route checks first.
function requireServerKey(key: string) {
  const expected = process.env.NARU_PAYMENTS_KEY;

  if (!expected || expected.length < 32)
    throw new ConvexError(
      "Payment writes are not configured on this deployment.",
    );

  if (key !== expected) throw new ConvexError("FORBIDDEN");
}

function requireMatch(value: string, pattern: RegExp, message: string): string {
  if (!pattern.test(value)) throw new ConvexError(message);

  return value;
}

const job = v.union(
  v.object({
    state: v.string(),
    hash: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
  }),
  v.null(),
);

const action = v.union(
  v.object({ kind: v.literal("reserve"), device: v.string() }),
  v.object({
    kind: v.literal("start"),
    attempt: v.string(),
    device: v.string(),
  }),
  v.object({
    kind: v.literal("cancel"),
    attempt: v.string(),
    device: v.string(),
  }),
  v.object({
    kind: v.literal("challenge"),
    attempt: v.string(),
    device: v.string(),
    deployment: v.string(),
  }),
  v.object({
    kind: v.literal("link"),
    attempt: v.string(),
    challenge: v.string(),
    deployment: v.string(),
    account: v.string(),
    credentialId: v.string(),
    publicKey: v.string(),
  }),
  v.object({
    kind: v.literal("report"),
    state: v.union(
      v.literal("passkey"),
      v.literal("pending"),
      v.literal("ready"),
      v.literal("rejected"),
    ),
    account: v.union(v.string(), v.null()),
    balance: v.union(v.string(), v.null()),
    balanceError: v.union(v.string(), v.null()),
    job,
  }),
);

export const current = query({
  args: {},
  handler: async (ctx) => {
    const row = await findPayment(ctx, await clerkUser(ctx));

    if (!row) return null;

    return {
      state: row.state,
      account: row.account,
      balance: row.balance,
      balanceError: row.balanceError,
      job: row.job,
    };
  },
});

export const enrollment = query({
  args: {},
  handler: async (ctx) => {
    const row = await findPayment(ctx, await clerkUser(ctx));

    if (!row) return null;

    return {
      attempt: row.attempt,
      device: row.device,
      started: row.started,
      account: row.account,
      deployment: row.deployment,
      candidate: row.candidate,
      challenge: row.challenge,
      expires: row.expires,
    };
  },
});

export const apply = mutation({
  args: { key: v.string(), action },
  handler: async (ctx, args) => {
    requireServerKey(args.key);
    const clerkUserId = await clerkUser(ctx);
    const request = args.action;

    if (request.kind === "reserve") {
      const existing = await findPayment(ctx, clerkUserId);

      if (existing) {
        if (!existing.account && existing.device !== request.device)
          throw new ConvexError(
            "Activation was started in another browser. Continue there with the same passkey.",
          );

        return {
          attempt: existing.attempt,
          started: existing.started,
          linked: existing.account !== null,
        };
      }

      const now = Date.now();
      const attempt = uuid();

      await ctx.db.insert("payments", {
        clerkUserId,
        device: requireMatch(
          request.device,
          devicePattern,
          "The activation device could not be verified.",
        ),
        attempt,
        started: false,
        account: null,
        credentialId: null,
        publicKey: null,
        deployment: null,
        candidate: null,
        challenge: null,
        expires: null,
        state: "passkey",
        balance: null,
        balanceError: null,
        job: null,
        updatedAt: now,
      });

      return { attempt, started: false, linked: false };
    }

    const row = await findPayment(ctx, clerkUserId);

    if (!row)
      throw new ConvexError(
        "No payment activation is in progress. Start again from this browser.",
      );

    if (request.kind === "report") {
      await ctx.db.patch(row._id, {
        state: request.state,
        account:
          request.account === null
            ? null
            : requireMatch(
                request.account,
                accountPattern,
                "The reported account is not a valid testnet address.",
              ),
        balance: request.balance,
        balanceError: request.balanceError?.slice(0, 300) ?? null,
        job: request.job,
        updatedAt: Date.now(),
      });

      return null;
    }

    requireMatch(
      request.attempt,
      attemptPattern,
      "This activation attempt is not valid.",
    );

    if (row.attempt !== request.attempt)
      throw new ConvexError(
        "This activation attempt belongs to another session. Refresh and try again.",
      );

    if (request.kind !== "link" && row.device !== request.device)
      throw new ConvexError(
        "This activation belongs to another browser. Continue there with the same passkey.",
      );

    if (request.kind === "start") {
      if (row.started || row.account)
        throw new ConvexError(
          "Passkey creation already started. Resume in the original browser; no new account was created.",
        );

      await ctx.db.patch(row._id, { started: true, updatedAt: Date.now() });

      return null;
    }

    if (request.kind === "cancel") {
      if (row.account || row.candidate) return null;

      await ctx.db.patch(row._id, { started: false, updatedAt: Date.now() });

      return null;
    }

    if (request.kind === "challenge") {
      if (row.account)
        throw new ConvexError(
          "This account is already linked. Resume activation.",
        );

      if (request.deployment.length > 40_000)
        throw new ConvexError("The deployment payload is too large.");

      const challenge = base64url(crypto.getRandomValues(new Uint8Array(32)));

      await ctx.db.patch(row._id, {
        candidate: request.deployment,
        challenge,
        expires: Date.now() + 120_000,
        updatedAt: Date.now(),
      });

      return { challenge };
    }

    if (
      row.account ||
      !row.candidate ||
      !row.challenge ||
      !row.expires ||
      row.expires <= Date.now()
    )
      throw new ConvexError("Passkey confirmation expired. Please retry.");

    if (
      row.candidate !== request.deployment ||
      row.challenge !== request.challenge
    )
      throw new ConvexError(
        "The passkey proof does not match this activation. Please retry.",
      );

    await ctx.db.patch(row._id, {
      account: requireMatch(
        request.account,
        accountPattern,
        "The verified account is not a valid testnet address.",
      ),
      credentialId: requireMatch(
        request.credentialId,
        credentialPattern,
        "The verified credential is not valid.",
      ),
      publicKey: requireMatch(
        request.publicKey,
        publicKeyPattern,
        "The verified public key is not valid.",
      ),
      deployment: row.candidate,
      candidate: null,
      challenge: null,
      expires: null,
      state: "pending",
      balance: null,
      balanceError: null,
      job: null,
      updatedAt: Date.now(),
    });

    return null;
  },
});
