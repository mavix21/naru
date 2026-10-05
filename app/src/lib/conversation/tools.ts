import "server-only";
import type { Id } from "@naru/backend/data-model";
import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { Asset } from "@stellar/stellar-sdk";
import { tool } from "ai";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import type { PaymentState } from "@/lib/smart-account/payments";

import { serverKey } from "@/lib/auth/server";
import { displayAmount, parseAmount, TESTNET_ASSETS } from "@/lib/money";
import {
  fundPayment,
  readPaymentStatus,
} from "@/lib/smart-account/server/payments-http";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import { TESTNET, TEST_FUNDING } from "@/lib/smart-account/shared";
import { prepareSwapReview } from "@/lib/swaps/server";

import type { DirectTransferRequest } from "./transfer-request";

export function moneyTools(
  getToken: () => Promise<string>,
  messageId: string,
  selectedIds: Set<string>,
  requests: FunctionReturnType<typeof api.splits.context>,
  userText: string,
  requireFundingAccess: () => Promise<void>,
  directTransfer: DirectTransferRequest | null = null,
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
        "Show this authenticated user’s wallet: its full public address, copy button, actual Stellar Testnet XLM and official USDC balances, and free test-XLM funding button. Use for balance, wallet address, public key, receiving details, or how to find their wallet. Do not use as a prerequisite or substitute for a requested transfer: prepareTransfer checks balances and creates the confirmation card itself. The address is public and safe to show to its owner, not a private key or passkey. A null balance is unavailable, not zero. Never infer an address or balance from conversation text.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready" || !payment.account)
          return { active: false, activationPath: "/activate" };
        let current: PaymentState;

        try {
          current = await readPaymentStatus(
            new SmartAccountService(),
            token,
            null,
          );
        } catch {
          current = {
            state: "ready",
            account: payment.account,
            job: null,
            balance: null,
            balanceError:
              "Your balance couldn’t refresh. Your wallet address is still available.",
            usdcBalance: null,
            usdcBalanceError: "USDC balance is unavailable. Please refresh.",
          };
        }

        if (current.state !== "ready")
          return { active: false, activationPath: "/activate" };

        return {
          active: true,
          address: payment.account,
          amount:
            current.balance === null ? null : displayAmount(current.balance),
          balanceError: current.balanceError,
          asset: "XLM",
          usdcAmount:
            current.usdcBalance == null
              ? null
              : displayAmount(current.usdcBalance),
          usdcError: current.usdcBalanceError ?? null,
          network: "Stellar testnet",
          observedAt: new Date().toISOString(),
        };
      },
    }),
    fundWallet: tool({
      description: `Add ${TEST_FUNDING.label} free test XLM to the authenticated user’s own Naru wallet when they ask for test funds, a refill, or Friendbot. Repeatable after a completed top-up. This submits a sponsor-funded Testnet deposit; it never spends the user’s money and needs no passkey. Accepts no recipient or amount. Do not call merely for a balance/address question. A pending result is not success; the funding card checks confirmation automatically.`,
      inputSchema: z.object({}).strict(),
      execute: async () => {
        try {
          await requireFundingAccess();
          const token = await getToken();
          const payment = await fetchQuery(api.payments.current, {}, { token });

          if (payment?.state !== "ready" || !payment.account)
            return { active: false, activationPath: "/activate" };

          const result = await fundPayment(
            new SmartAccountService(),
            token,
            `chat:${messageId}`,
          );

          return {
            active: true,
            ...result,
            instruction:
              "Show the funding card and at most one short sentence. Only say XLM was added if funding.state is confirmed. If failed, briefly report the failure. Never call this tool again to check status. Do not repeat card contents or explain Testnet unless asked.",
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : "Test funding is unavailable. Try again shortly.",
          };
        }
      },
    }),
    prepareSwap: tool({
      description:
        "Prepare ONE live XLM → USDC swap quote on Stellar Testnet when the user requests a swap. Accept either an XLM amount to spend or a USDC amount to receive. For 'I want 1 USDC; swap as much XLM as needed', pass amount='1' and amountType='receive'; the server calculates the XLM cost from live quotes and protects the USDC target. Do not ask for an XLM amount when the receive amount is known. This cannot sign or execute. No other assets, reverse direction, or destination are supported. The user must review the quote card and explicitly authorize with a passkey. Never substitute tokens or estimate a quote yourself.",
      inputSchema: z
        .object({
          amount: z
            .string()
            .max(40)
            .describe(
              "The user-specified decimal amount, without an asset symbol.",
            ),
          amountType: z
            .enum(["spend", "receive"])
            .describe(
              "spend = XLM to sell; receive = USDC to obtain with XLM.",
            ),
          assetIn: z.string().max(12),
          assetOut: z.string().max(12),
        })
        .strict(),
      execute: async ({ amount, amountType, assetIn, assetOut }) => {
        if (assetIn !== "XLM" || assetOut !== "USDC")
          return {
            error:
              "Only XLM → official Testnet USDC swaps are supported. Ask before changing assets.",
          };
        const token = await getToken();
        const payment = await fetchQuery(api.payments.current, {}, { token });

        if (payment?.state !== "ready" || !payment.account)
          return { active: false, activationPath: "/activate" };
        const service = new SmartAccountService();

        try {
          const prepared = await prepareSwapReview(
            service,
            payment.account,
            amount,
            amountType,
          );

          const operationId = await fetchMutation(
            api.operations.prepareSwap,
            {
              key: serverKey(),
              messageId,
              account: payment.account,
              token: service.config.publicConfig.token,
              ...prepared,
            },
            { token: await getToken() },
          );

          return {
            operationId,
            instruction:
              "Briefly ask the user to review the live swap card. Do not print the internal operationId or duplicate quote amounts in chat text. Nothing has been swapped. Only the user can confirm its displayed quote with a passkey.",
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : "No live swap quote is available. Nothing was prepared.",
          };
        }
      },
    }),
    prepareTransfer: tool({
      description:
        "Prepare ONE direct XLM or official USDC transfer to a selected accepted friend on Stellar Testnet, only when explicitly requested. Never use this to pay a saved split request: use prepareRequestPayment. This only saves a review, even if the balance is insufficient or unavailable. The card shows the shortfall and offers a separate swap review for USDC. Never swap automatically. The user must explicitly authorize each swap and transfer separately with a passkey.",
      inputSchema: z
        .object({
          userId: directTransfer?.userId
            ? z.literal(directTransfer.userId)
            : z.string().max(100),
          amount: directTransfer
            ? z.literal(directTransfer.amount)
            : z.string().max(40),
          asset: directTransfer
            ? z.literal(directTransfer.asset)
            : z.string().max(12),
        })
        .strict(),
      execute: async ({ userId, amount, asset }) => {
        if (directTransfer && !directTransfer.userId)
          return {
            error:
              "Select your friend from the @ menu, then send this request again. A typed name alone is not a verified recipient. No transfer was prepared.",
            instruction:
              "Ask the user to type @ and choose their friend from the suggestions. Never ask them for a user ID or account address.",
          };

        if (asset !== "XLM" && asset !== "USDC")
          return {
            error:
              "Direct friend transfers support XLM and official Testnet USDC. Ask before changing assets.",
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

        const parsed = parseAmount(amount, asset);
        const service = new SmartAccountService();

        await Promise.all([
          service.requireAccount(payment.account),
          service.requireAccount(recipient.account),
        ]);

        // A draft can remain reviewable while funds are unavailable. A fresh
        // on-chain balance is required again before review AND submission.
        await readPaymentStatus(service, token, null).catch(() => null);

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
            token: TESTNET_ASSETS[asset],
            asset,
            ...parsed,
          },
          { token: await getToken() },
        );

        return {
          operationId,
          status: "awaiting_approval",
          instruction:
            "Show the live transfer card with one short review invitation. Nothing has been sent. Its balance check may show a shortfall; do not call prepareSwap or send automatically. Each needs separate review and passkey authorization.",
        };
      },
    }),
    prepareSplit: tool({
      description:
        "Prepare an editable equal split for review, never publish or send requests. Supports legacy XLM splits and USDC reimbursements for already-paid expenses. USDC requires includeSelf=true, mode=reimburse, and everyone's activated account. Participants must be structured mention IDs from this turn. XLM allows explicit self-exclusion and collecting before paying. Never change the user's asset or expense mode to make it fit.",
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
        if (asset !== "XLM" && asset !== "USDC")
          return {
            error:
              "Splits support XLM or official Testnet USDC. Ask before changing the asset.",
          };

        const id = await fetchMutation(
          api.splits.prepare,
          {
            key: serverKey(),
            messageId,
            token: TESTNET_ASSETS[asset],
            asset,
            creationId:
              asset === "USDC" ? randomBytes(32).toString("hex") : undefined,
            participantIds: participantIds.map(requireSelected),
            ...fields,
          },
          { token: await getToken() },
        );

        return {
          splitId: id,
          status: "draft",
          instruction:
            "The live split card is ready to edit and review. Requests have NOT been sent. USDC publication requires the organizer's passkey, creates requests only (no transfers or charges), and delivers into friend DMs only after chain confirmation. Use the card to confirm.",
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
