import "server-only";
import { api } from "@naru/backend/api";
import { tool } from "ai";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { serverKey } from "@/lib/auth/server";
import { displayAmount, parseAmount } from "@/lib/money";
import { readPaymentStatus } from "@/lib/smart-account/server/payments-http";
import { SmartAccountService } from "@/lib/smart-account/server/service";

import { resolveRecipient } from "./recipients";

export function moneyTools(
  getToken: () => Promise<string>,
  messageId: string,
  explicitEmails: Set<string>,
) {
  const requireEmail = (email: string) => {
    const exact = email.trim().toLowerCase();

    if (!explicitEmails.has(exact))
      throw new Error(
        "Ask the user for the recipient’s exact registered email. Never infer it from a name.",
      );

    return exact;
  };

  return {
    readBalance: tool({
      description:
        "Read this authenticated user’s actual Stellar testnet XLM balance. Never infer a balance from conversation text.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready" || !payment.account)
          return { active: false, activationPath: "/activate" };
        const service = new SmartAccountService();

        try {
          const current = await readPaymentStatus(service, token, null);

          if (current.state !== "ready")
            return { active: false, activationPath: "/activate" };

          if (current.balance === null)
            throw new Error(
              current.balanceError ||
                "The current balance is unavailable. Please refresh Account.",
            );
          const units = current.balance;

          return {
            active: true,
            amount: displayAmount(units),
            asset: "XLM",
            network: "Stellar testnet",
            observedAt: new Date().toISOString(),
          };
        } finally {
          service.store.close();
        }
      },
    }),
    resolveRecipient: tool({
      description:
        "Resolve only an exact email explicitly supplied by the user, verified in Clerk and linked to a registered active Naru account. No search, names, or partial matches.",
      inputSchema: z.object({ email: z.email().max(254) }).strict(),
      execute: async ({ email }) => {
        const token = await getToken();
        const recipient = await resolveRecipient(requireEmail(email), token);

        return {
          email: recipient.email,
          name: recipient.name,
          account: recipient.account,
          verified: true,
        };
      },
    }),
    prepareTransfer: tool({
      description:
        "Prepare ONE transfer draft for user review, only when explicitly requested. This cannot sign, confirm, or send money. XLM on Stellar testnet is the only supported asset. The user must use the card and passkey to send.",
      inputSchema: z
        .object({
          email: z.email().max(254),
          amount: z.string().max(40),
          asset: z.string().max(12),
        })
        .strict(),
      execute: async ({ email, amount, asset }) => {
        if (asset !== "XLM")
          return {
            error:
              "Only test XLM is supported. Ask whether the user wants an XLM transfer; do not substitute assets.",
          };
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready" || !payment.account)
          return { active: false, activationPath: "/activate" };
        const recipient = await resolveRecipient(requireEmail(email), token);
        const parsed = parseAmount(amount);
        const service = new SmartAccountService();

        try {
          await Promise.all([
            service.requireAccount(payment.account),
            service.requireAccount(recipient.account),
          ]);

          if (
            BigInt(await service.balance(payment.account)) <
            BigInt(parsed.units)
          )
            return {
              error: "Insufficient test XLM balance. No transfer was prepared.",
            };

          const operationId = await fetchMutation(
            api.operations.prepare,
            {
              key: serverKey(),
              messageId,
              account: payment.account,
              recipientUserId: recipient.userId,
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              recipient: recipient.account,
              token: service.config.publicConfig.token,
              ...parsed,
            },
            { token: await getToken() },
          );

          return {
            operationId,
            status: "awaiting_approval",
            instruction:
              "Read the live operation card. Nothing has been sent. Confirm and authorize with a passkey there.",
          };
        } finally {
          service.store.close();
        }
      },
    }),
  };
}
