import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { readJson, requireRequest, serverKey } from "@/lib/auth/server";
import { validateSignedAuthorization } from "@/lib/smart-account/server/policy";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import {
  assertSharePaymentJob,
  reconcileSharePayment,
  requirePayableShare,
  reviewSharePayment,
} from "@/lib/splits/payments-server";
import {
  validateSharePaymentAuthorization,
  validateSharePaymentEnvelope,
} from "@/lib/splits/policy";

export const maxDuration = 150;

const input = z
  .object({
    action: z.enum(["review", "authorize", "status"]),
    id: z.string().min(1).max(100),
    reviewId: z.string().max(100).optional(),
    auth: z.string().max(30_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const { token, userId } = await requireRequest(request, true);
    const body = await readJson(request, input);
    const key = serverKey();
    const service = new SmartAccountService();
    // SAFETY: Convex validates the table ID and authenticated participant/organizer.
    const id = body.id as Id<"paymentRequests">;

    const terms = await fetchQuery(
      api.splits.paymentTerms,
      { key, id },
      { token },
    );

    await service.store.rate(
      `split-payment:${userId}:${Math.floor(Date.now() / 60_000)}`,
      40,
    );

    if (body.action === "status" || terms.request.state !== "outstanding") {
      await reconcileSharePayment(service, terms, token);

      return Response.json({ ok: true });
    }

    if (terms.isOrganizer)
      throw new Error("Only the requested friend can pay this share.");

    if (body.action === "review") {
      const review = await reviewSharePayment(service, terms);
      await fetchMutation(
        api.splits.bindPayment,
        { key, id, reviewId: review.id },
        { token },
      );

      return Response.json({ review });
    }

    if (
      !body.auth ||
      !body.reviewId ||
      terms.request.settlement?.reviewId !== body.reviewId
    )
      throw new Error(
        "Passkey authorization must match this request’s review.",
      );
    const job = await service.store.get(body.reviewId);

    if (!job) throw new Error("Payment review unavailable.");
    assertSharePaymentJob(service, job, terms);
    const auth = validateSignedAuthorization(job.auth, body.auth);
    validateSharePaymentAuthorization(auth, terms.intent);
    await requirePayableShare(service, terms);

    const claimed = await fetchMutation(
      api.splits.claimPayment,
      { key, id, reviewId: job.id },
      { token },
    );

    if (claimed) {
      try {
        await service.submit(job, [auth], (tx) =>
          validateSharePaymentEnvelope(
            tx.toXDR(),
            tx.hash().toString("hex"),
            service.config.publicConfig.sponsor,
            terms.intent,
            job.auth,
            job.expires,
          ),
        );
      } catch (error) {
        const current = await service.store.get(job.id);

        if (current?.state === "review")
          await service.store.finish(
            job.id,
            "failed",
            null,
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Payment could not be submitted.",
            "review",
          );
      }
    }

    await reconcileSharePayment(
      service,
      { ...terms, request: { ...terms.request, state: "submitting" } },
      token,
    );

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Payment unavailable. Check its status.",
      },
      { status: 400 },
    );
  }
}
