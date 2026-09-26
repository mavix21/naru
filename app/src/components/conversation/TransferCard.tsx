"use client";

import type { Doc } from "@naru/backend/data-model";

import { IconExternalLink, IconReceipt } from "@tabler/icons-react";
import { useState } from "react";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { conversationRequest } from "@/lib/conversation/client";
import { parseAmount } from "@/lib/money";
import { reviewSchema } from "@/lib/smart-account/shared";

type TransferResponse = { operation: Doc<"operations">; review?: unknown };

export const operationLabels = {
  awaiting_approval: "Awaiting your approval",
  submitting: "Waiting for confirmation",
  confirmed: "Sent · confirmed",
  cancelled: "Cancelled",
  failed: "Transfer failed",
} as const;

export function TransferCard({
  operation,
  userId,
  onUpdate,
  onEditRecipient,
}: {
  operation: Doc<"operations">;
  userId: string;
  onUpdate?: (operation: Doc<"operations">) => void;
  onEditRecipient?: (email: string) => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(operation.amount);
  const editable = operation.state === "awaiting_approval";

  async function action(kind: "cancel" | "edit" | "review") {
    if (busy) return;
    setError(undefined);
    setBusy(kind === "review" ? "Opening your passkey…" : "Saving…");

    try {
      if (kind === "review") {
        if (!navigator.locks)
          throw new Error("Use a current browser with passkey support.");
        await navigator.locks.request(
          `naru:transfer:${operation._id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw new Error("This transfer is open in another tab.");

            const { NaruSmartAccount } =
              await import("@/lib/smart-account/adapter");

            const account = await NaruSmartAccount.open(
              "/api/payments",
              userId,
            );

            await account.restore();

            const data = await conversationRequest<TransferResponse>(
              userId,
              "/api/transfers",
              {
                action: "review",
                id: operation._id,
                revision: operation.revision,
              },
            );

            if (!data.review) {
              onUpdate?.(data.operation);

              return;
            }

            const review = reviewSchema.parse(data.review);
            setBusy("Authorize on your device…");
            const auth = await account.signTransfer(review, operation);
            setBusy("Submitting authorized transfer…");

            const result = await conversationRequest<TransferResponse>(
              userId,
              "/api/transfers",
              {
                action: "authorize",
                id: operation._id,
                revision: operation.revision,
                reviewId: review.id,
                auth,
              },
            );

            onUpdate?.(result.operation);
          },
        );
      } else {
        const result = await conversationRequest<TransferResponse>(
          userId,
          "/api/transfers",
          {
            action: kind,
            id: operation._id,
            revision: operation.revision,
            amount: kind === "edit" ? parseAmount(amount).amount : undefined,
          },
        );

        onUpdate?.(result.operation);
        setEditing(false);
      }
    } catch (cause) {
      setError(
        cause instanceof Error &&
          /cancel|NotAllowed|denied|timed out/i.test(
            `${cause.name} ${cause.message}`,
          )
          ? "Passkey not authorized. Check the card’s status before trying again."
          : cause instanceof Error
            ? cause.message
            : "Couldn’t finish. Check the transfer’s status.",
      );
    } finally {
      setBusy(undefined);
      void conversationRequest(userId, "/api/transfers").catch(() => {});
    }
  }

  return (
    <article
      aria-label={`Transfer to ${operation.recipientName}`}
      className="my-5 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-xs"
    >
      <div className="p-5 md:p-6">
        <div className="mb-5 flex items-center justify-between gap-3 text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
          <span>
            {operation.requestId ? "Paying your share" : "Sending money"}{" "}
            <span aria-hidden="true">↗</span>
          </span>
          <span className="rounded-full border px-2.5 py-1 tracking-normal normal-case">
            Stellar testnet
          </span>
        </div>
        <p className="text-[34px] leading-tight tracking-[-.05em] tabular-nums">
          {operation.amount}{" "}
          <span className="text-lg tracking-normal text-muted-foreground">
            {operation.asset}
          </span>
        </p>
        <p className="mt-4 text-sm">
          To <span className="font-medium">{operation.recipientName}</span>
        </p>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {operation.recipientUsername
            ? `@${operation.recipientUsername}`
            : operation.recipientEmail}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span aria-hidden="true">✓ </span>
          {operation.recipientProfileId
            ? "Accepted friend · verified associated Naru account"
            : "Verified registered Naru account"}
        </p>
        <details className="mt-4 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Account & sponsorship</summary>
          <p className="mt-2 break-all font-mono">{operation.recipient}</p>
          <p className="mt-2 leading-relaxed">
            Naru sponsors network fees, capped at 0.5 test XLM. You send exactly{" "}
            {operation.amount} XLM. Test funds have no real monetary value.
          </p>
        </details>
        <Marker render={<output />} className="mt-5">
          <MarkerContent shimmer={!!busy || operation.state === "submitting"}>
            {busy || operationLabels[operation.state]}
          </MarkerContent>
        </Marker>
        {(error || operation.error) && (
          <p
            role="alert"
            className="mt-3 text-xs leading-relaxed text-destructive"
          >
            {error || operation.error}
          </p>
        )}
        {operation.hash && (
          <Attachment size="sm" className="mt-4 w-full">
            <AttachmentMedia>
              <IconReceipt aria-hidden="true" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>Transaction details</AttachmentTitle>
              <AttachmentDescription>
                {operation.hash.slice(0, 8)}…{operation.hash.slice(-6)} ·
                Stellar Expert
              </AttachmentDescription>
            </AttachmentContent>
            <IconExternalLink
              aria-hidden="true"
              className="mr-2 size-4 text-muted-foreground"
            />
            <AttachmentTrigger
              render={
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${operation.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open transaction ${operation.hash} on Stellar Expert (opens in a new tab)`}
                />
              }
            />
          </Attachment>
        )}
      </div>
      {editable && (
        <div className="border-t bg-muted/25 px-5 py-4 md:px-6">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action("edit");
              }}
            >
              <label className="text-xs" htmlFor={`amount-${operation._id}`}>
                Exact amount · XLM
              </label>
              <input
                id={`amount-${operation._id}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                maxLength={40}
                disabled={!!busy}
                className="mt-2 block w-full rounded-xl border bg-background px-3 py-2 text-base outline-ring"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={!!busy}>
                  Save review
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setEditing(false)}
                >
                  Back
                </Button>
              </div>
              {onEditRecipient && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-2"
                  disabled={!!busy}
                  onClick={async () => {
                    // Retire the old immutable recipient before composing a replacement.
                    setBusy("Cancelling draft…");
                    setError(undefined);

                    try {
                      const result =
                        await conversationRequest<TransferResponse>(
                          userId,
                          "/api/transfers",
                          {
                            action: "cancel",
                            id: operation._id,
                            revision: operation.revision,
                          },
                        );

                      onUpdate?.(result.operation);

                      if (result.operation.state === "cancelled")
                        onEditRecipient(operation.amount);
                    } catch {
                      setError(
                        "Couldn’t cancel this draft. Check its status first.",
                      );
                    } finally {
                      setBusy(undefined);
                    }
                  }}
                >
                  Change recipient instead ↗
                </Button>
              )}
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={!!busy}
                onClick={() => void action("review")}
              >
                Confirm with passkey
              </Button>
              {!operation.requestId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => {
                    setAmount(operation.amount);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => void action("cancel")}
              >
                {operation.requestId ? "Close payment review" : "Cancel"}
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
