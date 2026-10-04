import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { xdr } from "@stellar/stellar-sdk";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { readJson, requireRequest, serverKey } from "@/lib/auth/server";
import { displayAmount } from "@/lib/money";
import { readPaymentStatus } from "@/lib/smart-account/server/payments-http";
import { addressCredentials } from "@/lib/smart-account/server/policy";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import { validateSwapEnvelope } from "@/lib/swaps/policy";
import {
  assertSwapJob,
  operationIntent,
  prepareSwapReview,
  reconcileSwap,
  signedSwap,
  validateSwapOwner,
} from "@/lib/swaps/server";

export const maxDuration = 150;

const input = z
  .object({
    action: z.enum(["review", "quote", "authorize", "cancel"]),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    reviewId: z.string().max(100).optional(),
    auth: z.string().max(30_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };

  try {
    const { token, userId } = await requireRequest(request, true);
    const body = await readJson(request, input);
    const service = new SmartAccountService();
    const key = serverKey();
    await service.store.rate(
      `swaps:${userId}:${Math.floor(Date.now() / 60_000)}`,
      20,
    );
    // SAFETY: Convex validates the ID and checks its authenticated owner.
    const id = body.id as Id<"operations">;
    const operation = await fetchQuery(api.operations.get, { id }, { token });
    const intent = operationIntent(operation);

    if (operation.revision !== body.revision)
      if (body.action === "quote")
        return Response.json({ operation }, { headers });
      else
        throw new Error(
          "This quote changed. Read the updated card before confirming.",
        );

    if (operation.state !== "awaiting_approval") {
      await reconcileSwap(operation, token, service);

      if (operation.state === "submitting")
        await readPaymentStatus(service, token, null);

      return Response.json(
        { operation: await fetchQuery(api.operations.get, { id }, { token }) },
        { headers },
      );
    }

    if (body.action === "cancel") {
      await fetchMutation(
        api.operations.change,
        { key, id, revision: body.revision, action: { kind: "cancel" } },
        { token },
      );
    } else if (body.action === "quote") {
      // Multiple visible cards or tabs may refresh the same expired quote.
      if (intent.swap.expiresAt > Date.now())
        return Response.json({ operation }, { headers });
      const payment = await fetchQuery(api.payments.current, {}, { token });

      if (payment?.state !== "ready" || payment.account !== intent.account)
        throw new Error("Activate your Naru account first.");

      const prepared = await prepareSwapReview(
        service,
        intent.account,
        intent.swap.targetOut
          ? displayAmount(intent.swap.targetOut)
          : operation.amount,
        intent.swap.targetOut ? "receive" : "spend",
      );

      await fetchMutation(
        api.operations.prepareSwap,
        {
          key,
          id,
          revision: body.revision,
          messageId: operation.messageId,
          account: intent.account,
          token: intent.token,
          ...prepared,
        },
        { token },
      );
    } else {
      await validateSwapOwner(operation, token, service);

      const job = operation.reviewId
        ? await service.store.get(operation.reviewId)
        : null;

      if (!job) throw new Error("Swap review is unavailable. Get a new quote.");
      assertSwapJob(job, intent, service.config.publicConfig.sponsor);

      if (body.action === "review") {
        if (job.state !== "review")
          throw new Error(
            "This authorization was already used. Refresh the transaction status.",
          );

        return Response.json(
          {
            review: {
              id: job.id,
              auth: job.auth,
              expiresAt: job.expires,
              expiration: addressCredentials(
                xdr.SorobanAuthorizationEntry.fromXDR(job.auth, "base64"),
              ).signatureExpirationLedger(),
            },
          },
          { headers },
        );
      }

      if (!body.auth || body.reviewId !== operation.reviewId)
        throw new Error("Authorize this exact quote with your passkey.");
      const signed = await signedSwap(operation, job, body.auth, service);
      await fetchMutation(
        api.operations.change,
        {
          key,
          id,
          revision: body.revision,
          action: { kind: "submit", reviewId: job.id },
        },
        { token },
      );

      try {
        await service.submit(job, [signed], (transaction) => {
          validateSwapEnvelope(
            transaction.toXDR(),
            transaction.hash().toString("hex"),
            service.config.publicConfig.sponsor,
            intent,
          );
        });
      } catch (error) {
        await service.store.finish(
          job.id,
          "failed",
          null,
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Swap authorization could not be submitted.",
          "review",
        );
      }

      await reconcileSwap(
        { ...operation, state: "submitting" },
        token,
        service,
      );
      await readPaymentStatus(service, token, null);
    }

    return Response.json(
      { operation: await fetchQuery(api.operations.get, { id }, { token }) },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Couldn’t update this swap. Check its status before trying again.",
      },
      { status: 400, headers },
    );
  }
}
