import "server-only";
import type { Id } from "@naru/backend/data-model";
import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { Asset } from "@stellar/stellar-sdk";
import { tool } from "ai";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { serverKey } from "@/lib/auth/server";
import { displayAmount, parseAmount } from "@/lib/money";
import { readPaymentStatus } from "@/lib/smart-account/server/payments-http";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import { TESTNET } from "@/lib/smart-account/shared";

export function moneyTools(
  getToken: () => Promise<string>,
  messageId: string,
  selectedIds: Set<string>,
  requests: FunctionReturnType<typeof api.splits.context>,
  userText: string,
) {
  const requireSelected = (id: string) => {
    if (!selectedIds.has(id))
      throw new Error(
        "Select the friend using @ in your message. Plain names are not verified recipients.",
      );

    // SAFETY: id is present in this turn's Convex-validated structured mentions.
    return id as Id<"profiles">;
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
    prepareTransfer: tool({
      description:
        "Prepare ONE new direct transfer draft, only when explicitly requested. Never use this to pay a saved split request: use prepareRequestPayment so the server derives its exact terms and associates settlement. This cannot sign, confirm, or send money. XLM on Stellar testnet only; the user must use the card and passkey to send.",
      inputSchema: z
        .object({
          userId: z.string().max(100),
          amount: z.string().max(40),
          asset: z.string().max(12),
        })
        .strict(),
      execute: async ({ userId, amount, asset }) => {
        if (asset !== "XLM")
          return {
            error:
              "Only test XLM is supported. Ask whether the user wants an XLM transfer; do not substitute assets.",
          };
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready" || !payment.account)
          return { active: false, activationPath: "/activate" };

        const recipient = await fetchQuery(
          api.operations.friendRecipient,
          { key: serverKey(), id: requireSelected(userId) },
          { token },
        );

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
              recipientEmail: "",
              recipientName: recipient.person.displayName,
              recipientProfileId: recipient.person.userId,
              recipientUsername: recipient.person.username,
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
    prepareSplit: tool({
      description:
        "Prepare an editable equal split for review, never send requests. Participants must be structured mention IDs from this turn. Default includeSelf=true for shared expenses; false only for explicit exclusion. collect means collecting before paying; reimburse only when the user explicitly says they already paid.",
      inputSchema: z
        .object({
          title: z.string().min(1).max(100),
          total: z.string().max(40),
          asset: z.string().max(12),
          participantIds: z.array(z.string().max(100)).min(1).max(12),
          includeSelf: z.boolean().default(true),
          mode: z.enum(["collect", "reimburse"]).default("collect"),
        })
        .strict(),
      execute: async ({ asset, participantIds, ...fields }) => {
        if (asset !== "XLM")
          return {
            error: "Only test XLM is supported. Ask before changing the asset.",
          };

        const id = await fetchMutation(
          api.splits.prepare,
          {
            key: serverKey(),
            messageId,
            token: Asset.native().contractId(TESTNET.networkPassphrase),
            participantIds: participantIds.map(requireSelected),
            ...fields,
          },
          { token: await getToken() },
        );

        return {
          splitId: id,
          status: "draft",
          instruction:
            "The live split card is ready to edit and review. Requests have NOT been sent. The user must press Send requests.",
        };
      },
    }),
    prepareRequestPayment: tool({
      description:
        "Prepare the trusted payment review for an existing incoming request. Supply only its exact request ID from context. The server derives the full amount, asset and organizer account; nothing is signed or sent. Ask which split if ambiguous.",
      inputSchema: z.object({ requestId: z.string().max(100) }).strict(),
      execute: async ({ requestId }) => {
        const target = requests.find(
          (r) => r.requestId === requestId && r.direction === "incoming",
        );

        if (!target || target.state !== "outstanding")
          return {
            error:
              "Choose an outstanding incoming request. Do not repeat a pending or paid transfer.",
          };

        const candidates = requests.filter(
          (r) =>
            r.direction === "incoming" &&
            r.other.userId === target.other.userId &&
            r.state === "outstanding",
        );

        const specified = candidates.filter(
          (r) =>
            userText.toLowerCase().includes(r.title.toLowerCase()) ||
            userText.includes(r.requestId),
        );

        if (
          candidates.length > 1 &&
          (specified.length !== 1 || specified[0].requestId !== requestId)
        )
          return {
            error:
              "Ask which split the user wants to pay, or have them use Pay on the exact request card.",
          };
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready")
          return {
            active: false,
            instruction:
              "Use Activate payments on this request's card to return here after activation.",
          };

        const operationId = await fetchMutation(
          api.operations.prepareRequest,
          {
            key: serverKey(),
            requestId: target.requestId,
            token: Asset.native().contractId(TESTNET.networkPassphrase),
          },
          { token },
        );

        const operation = await fetchQuery(
          api.operations.get,
          { id: operationId },
          { token },
        );

        return {
          operationId,
          status: operation.state,
          instruction:
            "Use the payment review card and explicitly authorize with your passkey. Nothing is sent by this tool.",
        };
      },
    }),
    prepareReply: tool({
      description:
        "Preview a short outbound reply to ONE specific payment request from the supplied request context. Ask which split if ambiguous. This shares nothing until the user confirms the preview card; promises are only messages, never scheduled payments.",
      inputSchema: z
        .object({
          requestId: z.string().max(100),
          text: z.string().min(1).max(500),
        })
        .strict(),
      execute: async ({ requestId, text }) => {
        const target = requests.find((r) => r.requestId === requestId);

        if (!target)
          throw new Error("Choose a request from the server-provided context.");

        const candidates = requests.filter(
          (r) => r.other.userId === target.other.userId,
        );

        const specified = candidates.filter(
          (r) =>
            userText.toLowerCase().includes(r.title.toLowerCase()) ||
            userText.includes(r.requestId),
        );

        if (
          candidates.length > 1 &&
          (specified.length !== 1 || specified[0].requestId !== requestId)
        )
          return {
            error:
              "More than one request involves this person. Ask which split, or direct the user to Reply on its card.",
          };

        const id = await fetchMutation(
          api.replies.prepareFromChat,
          { key: serverKey(), messageId, requestId: target.requestId, text },
          { token: await getToken() },
        );

        return {
          replyId: id,
          status: "draft",
          instruction:
            "Show the preview card. Nothing shared until Confirm & send. This is not a scheduled payment.",
        };
      },
    }),
  };
}
