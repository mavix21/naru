import { z } from "zod";

import { jobSchema } from "./shared";

export const deploymentSchema = z
  .object({
    account: z.string().regex(/^C[A-Z2-7]{55}$/),
    credentialId: z.string().regex(/^[A-Za-z0-9_-]{22,683}$/),
    publicKey: z.string().regex(/^04[0-9a-f]{128}$/),
    payload: z
      .object({
        func: z.string().min(1).max(24_000),
        auth: z.array(z.string().min(1).max(24_000)).length(1),
      })
      .strict(),
  })
  .strict();

export type Deployment = z.infer<typeof deploymentSchema>;

export const passkeyProofSchema = z
  .object({
    credentialId: z.string().min(22).max(683),
    clientDataJSON: z.string().min(1).max(4096),
    authenticatorData: z.string().min(1).max(4096),
    signature: z.string().min(1).max(256),
  })
  .strict();

export type PasskeyProof = z.infer<typeof passkeyProofSchema>;

export const paymentStateSchema = z.object({
  state: z.enum(["inactive", "passkey", "pending", "ready", "rejected"]),
  account: z.string().nullable(),
  balance: z.string().nullable(),
  balanceError: z.string().nullable(),
  job: jobSchema.nullable(),
});

export type PaymentState = z.infer<typeof paymentStateSchema>;

export const reservationSchema = z.object({
  attempt: z.string().uuid(),
  started: z.boolean(),
  linked: z.boolean(),
});

export const challengeSchema = z.object({ challenge: z.string() });
