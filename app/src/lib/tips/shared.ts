import { z } from "zod";

// Client-safe terms for guest USDC tips. Testnet only; amounts are strings.
export const TIP = {
  presets: ["1", "3", "5", "10"],
  minimum: "0.1",
  maximum: "500",
  // Covers the base fee plus a direct SAC transfer's resource fee.
  maxFeeStroops: "10000000",
  lifetimeMs: 300_000,
  network: "Stellar Testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
} as const;

export const checkoutId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// Public goal amounts only; the server decides which goal a tip is bound to.
export const tipGoalSchema = z.object({
  title: z.string(),
  description: z.string(),
  target: z.string(),
  raised: z.string(),
  percent: z.number(),
  active: z.boolean(),
});

export type TipGoal = z.infer<typeof tipGoalSchema>;

export const tipReviewSchema = z.object({
  checkout: checkoutId,
  recipient: z.object({
    username: z.string(),
    displayName: z.string(),
    account: z.string(),
  }),
  sender: z.string(),
  network: z.literal(TIP.network),
  networkPassphrase: z.literal(TIP.networkPassphrase),
  asset: z.literal("USDC"),
  issuer: z.string(),
  amount: z.string(),
  fee: z.string(),
  xdr: z.string(),
  hash: z.string(),
  expiresAt: z.number(),
  goal: z.object({ title: z.string() }).nullable(),
});

export type TipReview = z.infer<typeof tipReviewSchema>;

export const tipStatusSchema = z.object({
  checkout: checkoutId,
  state: z.enum(["review", "pending", "confirmed", "failed"]),
  amount: z.string(),
  sender: z.string(),
  recipient: z.string(),
  fee: z.string(),
  hash: z.string(),
  ledger: z.number().nullable(),
  error: z.string().nullable(),
  expiresAt: z.number(),
  goal: tipGoalSchema.nullable(),
});

export type TipStatus = z.infer<typeof tipStatusSchema>;

export function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export const trustlineSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), hash: z.string().optional() }),
  z.object({ state: z.literal("pending"), hash: z.string() }),
  z.object({
    state: z.literal("sign"),
    xdr: z.string(),
    networkPassphrase: z.literal(TIP.networkPassphrase),
  }),
]);

export type TrustlineResult = z.infer<typeof trustlineSchema>;
