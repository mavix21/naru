import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { readJson, requireRequest, serverKey } from "@/lib/auth/server";
import {
  reconcileOperation,
  validateOperation,
} from "@/lib/conversation/transfers";
import { parseAmount } from "@/lib/money";
import { readPaymentStatus } from "@/lib/smart-account/server/payments-http";
import { SmartAccountService } from "@/lib/smart-account/server/service";

const operationInput = z
  .object({
    action: z.enum(["review", "authorize", "cancel", "edit"]),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    amount: z.string().max(40).optional(),
    reviewId: z.string().max(100).optional(),
    auth: z.string().max(30_000).optional(),
  })
  .strict();

const input = z.union([
  operationInput,
  z
    .object({
      action: z.literal("request"),
      requestId: z.string().min(1).max(100),
    })
    .strict(),
]);

async function handle(request: Request) {
  let service: SmartAccountService | undefined;

  try {
    const { token, userId } = await requireRequest(request, true);
    const key = serverKey();
    service = new SmartAccountService();
    service.store.rate(
      `conversation-payments:${userId}:${Math.floor(Date.now() / 60_000)}`,
      40,
    );

    if (request.method === "GET") {
      const operations = await fetchQuery(api.operations.recent, {}, { token });

      const incoming = await fetchQuery(
        api.operations.incomingForReconciliation,
        { key },
        { token },
      );

      for (const operation of [...operations, ...incoming])
        await reconcileOperation(operation, token, service);

      if (operations.some((operation) => operation.state === "submitting"))
        await readPaymentStatus(service, token, null);

      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = await readJson(request, input);

    if (body.action === "request") {
      // Only an ID crosses the browser boundary. Convex derives and freezes
      // amount, asset, payer and organizer account from the owned request.
      // SAFETY: Convex v.id validates the table ID and requestAccess checks the authenticated participant before any payment is prepared.
      const requestId = body.requestId as Id<"paymentRequests">;

      const id = await fetchMutation(
        api.operations.prepareRequest,
        { key, requestId, token: service.config.publicConfig.token },
        { token },
      );

      return Response.json({
        operation: await fetchQuery(api.operations.get, { id }, { token }),
      });
    }

    // SAFETY: Convex's v.id validator checks the table ID, and operations.get checks the authenticated owner before any use.
    const id = body.id as Id<"operations">;
    const operation = await fetchQuery(api.operations.get, { id }, { token });

    if (operation.revision !== body.revision)
      throw new Error(
        "This review changed. Read the updated card before confirming.",
      );

    if (operation.state !== "awaiting_approval") {
      await reconcileOperation(operation, token, service);

      return Response.json({
        operation: await fetchQuery(api.operations.get, { id }, { token }),
      });
    }

    if (body.action === "cancel") {
      await fetchMutation(
        api.operations.change,
        { key, id, revision: body.revision, action: { kind: "cancel" } },
        { token },
      );
    } else if (body.action === "edit") {
      const amount = parseAmount(body.amount ?? "");
      await validateOperation({ ...operation, ...amount }, token, service);
      await fetchMutation(
        api.operations.change,
        {
          key,
          id,
          revision: body.revision,
          action: { kind: "edit", ...amount },
        },
        { token },
      );
    } else {
      await validateOperation(operation, token, service);

      if (body.action === "review") {
        const review = await service.review(operation.account, {
          recipient: operation.recipient,
          amount: operation.amount,
        });

        await fetchMutation(
          api.operations.change,
          {
            key,
            id,
            revision: body.revision,
            action: { kind: "bind", reviewId: review.id },
          },
          { token },
        );

        return Response.json({ review });
      }

      if (!body.reviewId || !body.auth || operation.reviewId !== body.reviewId)
        throw new Error("Passkey authorization must match this operation.");
      const job = service.store.get(body.reviewId);

      if (!job || job.account !== operation.account || job.kind !== "transfer")
        throw new Error("Transfer review not found.");
      service.assertTransfer(job, operation);
      await fetchMutation(
        api.operations.change,
        {
          key,
          id,
          revision: body.revision,
          action: { kind: "submit", reviewId: body.reviewId },
        },
        { token },
      );

      try {
        await service.authorize(body.reviewId, body.auth);
      } catch (error) {
        const current = service.store.get(body.reviewId);

        if (current?.state === "review")
          service.store.finish(
            current.id,
            "failed",
            null,
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Authorization could not be submitted.",
          );
      }

      await reconcileOperation(
        { ...operation, state: "submitting" },
        token,
        service,
      );
    }

    return Response.json({
      operation: await fetchQuery(api.operations.get, { id }, { token }),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Couldn’t update this transfer. Check its status before trying again.",
      },
      { status: 400 },
    );
  } finally {
    service?.store.close();
  }
}

export const GET = handle;

export const POST = handle;
