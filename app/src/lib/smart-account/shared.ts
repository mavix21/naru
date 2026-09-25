import { z } from "zod";

// Isolated from the scaffold network configuration: this slice is testnet-only.
export const TESTNET = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  accountWasmHash:
    "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifierAddress:
    "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  verifierWasmHash:
    "e63a030d0f1a1481e36059a4837c433083b33e704c1f9625b7314795b6d72b76",
} as const;

export const jobSchema = z.object({
  id: z.string(),
  account: z.string(),
  kind: z.enum(["deploy", "fund", "transfer"]),
  state: z.enum(["review", "preparing", "pending", "confirmed", "failed"]),
  hash: z.string().nullable(),
  ledger: z.number().nullable(),
  error: z.string().nullable(),
});

export type Job = z.infer<typeof jobSchema>;

export const configSchema = z.object({
  origin: z.string(),
  rpId: z.string(),
  recipient: z.string(),
  sponsor: z.string(),
  token: z.string(),
  transferAmount: z.literal("0.1"),
  fundingAmount: z.literal("5"),
});

export type SmartAccountConfig = z.infer<typeof configSchema>;

export const statusSchema = z.object({
  account: z.string(),
  deployed: z.boolean(),
  balance: z.string().nullable(),
  jobs: z.array(jobSchema),
});

export type AccountStatus = z.infer<typeof statusSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  account: z.string(),
  recipient: z.string(),
  token: z.string(),
  amount: z.literal("0.1"),
  auth: z.string(),
  expiration: z.number(),
  expiresAt: z.number(),
});

export type TransferReview = z.infer<typeof reviewSchema>;

export function formatBalance(raw: string) {
  const amount = BigInt(raw);

  return `${amount / BigInt(10_000_000)}.${(amount % BigInt(10_000_000)).toString().padStart(7, "0")}`;
}
