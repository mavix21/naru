import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { readJson, requireRequest, serverKey } from "@/lib/auth/server";
import { validateSignedAuthorization } from "@/lib/smart-account/server/policy";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import {
  validateCreationAuthorization,
  validateCreationEnvelope,
} from "@/lib/splits/policy";
import {
  assertCreationJob,
  creationIntent,
  reconcileCreation,
  requireSplitContract,
  reviewCreation,
} from "@/lib/splits/server";

export const maxDuration = 150;

const input = z
  .object({
    action: z.enum(["review", "authorize", "status"]),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
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
    // SAFETY: Convex validates the table ID and authenticates its owner before use.
    const id = body.id as Id<"splits">;

    const split = await fetchQuery(
      api.splits.publication,
      { key, id },
      { token },
    );

    await service.store.rate(
      `split-publication:${userId}:${Math.floor(Date.now() / 60_000)}`,
      40,
    );

    if (body.action === "status" || split.state !== "draft") {
      await reconcileCreation(service, split, token);

      return Response.json({ ok: true });
    }

    if (body.revision !== split.revision)
      throw new Error("This split changed. Review it again.");
    await fetchQuery(
      api.splits.publication,
      { key, id, validate: true },
      { token },
    );

    if (body.action === "review") {
      const review = await reviewCreation(service, split);
      await fetchMutation(
        api.splits.bindCreation,
        { key, id, revision: body.revision, reviewId: review.id },
        { token },
      );

      return Response.json({ review });
    }

    if (
      !body.auth ||
      !body.reviewId ||
      split.creation?.reviewId !== body.reviewId
    )
      throw new Error("Passkey authorization must match this review.");
    const job = await service.store.get(body.reviewId);

    if (!job) throw new Error("Publication review unavailable.");
    const intent = creationIntent(split);
    assertCreationJob(service, job, intent);
    const auth = validateSignedAuthorization(job.auth, body.auth);
    validateCreationAuthorization(auth, intent);
    await requireSplitContract(service);
    await Promise.all(
      intent.participants.map((account) => service.requireAccount(account)),
    );

    const claimed = await fetchMutation(
      api.splits.claimCreation,
      { key, id, revision: body.revision, reviewId: body.reviewId },
      { token },
    );

    if (claimed) {
      try {
        await service.submit(job, [auth], (tx) =>
          validateCreationEnvelope(
            tx.toXDR(),
            tx.hash().toString("hex"),
            service.config.publicConfig.sponsor,
            intent,
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
              : "Publication could not be submitted.",
            "review",
          );
      }
    }

    await reconcileCreation(service, { ...split, state: "submitting" }, token);

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Publication unavailable. Refresh its status.",
      },
      { status: 400 },
    );
  }
}
