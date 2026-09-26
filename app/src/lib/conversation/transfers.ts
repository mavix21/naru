import "server-only";
import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";

import { serverKey } from "@/lib/auth/server";
import { parseAmount } from "@/lib/money";
import { SmartAccountService } from "@/lib/smart-account/server/service";

export async function validateOperation(
  operation: Doc<"operations">,
  token: string,
  service: SmartAccountService,
) {
  const [sender, recipient] = await Promise.all([
    fetchQuery(api.payments.current, {}, { token }),
    operation.recipientProfileId
      ? fetchQuery(
          api.operations.friendRecipient,
          { key: serverKey(), id: operation.recipientProfileId },
          { token },
        )
      : fetchQuery(
          api.operations.recipient,
          { key: serverKey(), user: operation.recipientUserId },
          { token },
        ).then((recipient) =>
          recipient
            ? { ...recipient, userId: operation.recipientUserId }
            : null,
        ),
  ]);

  if (sender?.state !== "ready" || sender.account !== operation.account)
    throw new Error("Activate your Naru payment account to continue.");

  if (
    !recipient ||
    recipient.userId !== operation.recipientUserId ||
    recipient.account !== operation.recipient
  )
    throw new Error(
      "The recipient account changed. Cancel this draft and review a new transfer.",
    );

  if (
    operation.asset !== "XLM" ||
    operation.token !== service.config.publicConfig.token ||
    parseAmount(operation.amount).units !== operation.units
  )
    throw new Error("The asset or amount does not match the saved operation.");

  if (operation.requestId) {
    const { request, split, isOrganizer } = await fetchQuery(
      api.splits.request,
      { id: operation.requestId },
      { token },
    );

    if (
      isOrganizer ||
      request.operationId !== operation._id ||
      request.state !== "outstanding" ||
      request.amount !== operation.amount ||
      request.units !== operation.units ||
      split.organizerAccount !== operation.recipient ||
      split.token !== operation.token ||
      split.organizer.userId !== operation.recipientProfileId
    )
      throw new Error(
        "The payment must match the current, full outstanding request.",
      );
  }

  await Promise.all([
    service.requireAccount(operation.account),
    service.requireAccount(operation.recipient),
  ]);

  if (
    BigInt(await service.balance(operation.account)) < BigInt(operation.units)
  )
    throw new Error("Your test XLM balance is too low for this transfer.");
}

export async function reconcileOperation(
  operation: Doc<"operations">,
  token: string,
  service: SmartAccountService,
) {
  if (operation.state !== "submitting" || !operation.reviewId) return;
  let record = service.store.get(operation.reviewId);

  if (!record || record.account !== operation.account) return;
  service.assertTransfer(record, operation);

  // A crash between the Convex claim and the local claim cannot be resubmitted
  // by rendering. Only an expired, never-claimed review is a definitive failure.
  if (record.state === "review" && record.expires < Date.now()) {
    service.store.finish(
      record.id,
      "failed",
      null,
      "Authorization was interrupted before submission. No transaction was sent.",
    );
    record = service.store.get(record.id)!;
  }

  const job = await service.reconcile(record);

  if (job.state === "confirmed") {
    if (!job.hash || !job.ledger)
      throw new Error("Missing confirmed transaction evidence.");
    service.assertTransfer(service.store.get(record.id)!, operation);
  }

  const error =
    job.state === "preparing" && record.created < Date.now() - 300_000
      ? "Submission was interrupted before a transaction reference was saved. The sponsor must reconcile this operation; do not repeat the payment."
      : job.error;

  await fetchMutation(
    api.operations.change,
    {
      key: serverKey(),
      id: operation._id,
      revision: operation.revision,
      action: {
        kind: "report",
        reviewId: record.id,
        state:
          job.state === "confirmed"
            ? "confirmed"
            : job.state === "failed"
              ? "failed"
              : "submitting",
        hash: job.hash,
        error,
      },
    },
    { token },
  );
}
