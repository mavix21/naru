"use client";

import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { IconExternalLink, IconReceipt } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
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
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useMessageDraft } from "@/hooks/useMessageDraft";
import { conversationRequest } from "@/lib/conversation/client";
import { parseAmount, transferShortfall } from "@/lib/money";
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
  const wallet = useQuery(api.payments.current);
  const walletQuery = useAccountStatus(userId);
  const { updateDraft } = useMessageDraft(userId);
  const router = useRouter();

  const balance = walletQuery.isError
    ? null
    : operation.asset === "USDC"
      ? (wallet?.usdcBalance ?? null)
      : (wallet?.balance ?? null);

  const shortfall = transferShortfall(operation.units, balance);

  async function action(kind: "cancel" | "edit" | "review" | "retry") {
    if (busy) return;
    setError(undefined);
    setBusy(kind === "review" ? "Opening your passkey…" : "Saving…");
    let submissionStarted = false;

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
            submissionStarted = true;

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
            amount:
              kind === "edit"
                ? parseAmount(amount, operation.asset).amount
                : undefined,
          },
        );

        onUpdate?.(result.operation);
        setEditing(false);
      }
    } catch (cause) {
      setError(
        submissionStarted
          ? "Couldn’t confirm submission. Check this transfer’s status before trying again."
          : cause instanceof Error &&
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
      void walletQuery.refetch();
    }
  }

  return (
    <article
      aria-label={`Transfer to ${operation.recipientName}`}
      className="my-4 w-full max-w-sm overflow-hidden rounded-3xl border border-border/70 bg-card shadow-xs"
    >
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3 text-sm font-medium">
          <span>
            {operation.requestId ? "Paying your share" : "Send money"}{" "}
            <span aria-hidden="true">↗</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-normal text-muted-foreground">
            Testnet
          </span>
        </div>
        <p className="break-all text-3xl leading-tight tracking-[-.04em] tabular-nums">
          {operation.amount}{" "}
          <span className="text-lg tracking-normal text-muted-foreground">
            {operation.asset}
          </span>
        </p>
        <p className="mt-3 text-sm">
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
            ? "Accepted friend · activated account"
            : "Verified registered Naru account"}
        </p>
        <details className="mt-4 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">
            Details · fees paid by Naru
          </summary>
          <p className="mt-2 break-all font-mono">{operation.recipient}</p>
          <p className="mt-2 leading-relaxed">
            Naru sponsors network fees, capped at 0.5 test XLM. You send exactly{" "}
            {operation.amount} {operation.asset}. Test funds have no real
            monetary value.
          </p>
        </details>
        <Marker render={<output />} className="mt-5">
          <MarkerContent shimmer={!!busy || operation.state === "submitting"}>
            {busy || operationLabels[operation.state]}
          </MarkerContent>
        </Marker>
        {editable && shortfall !== "0" && (
          <output className="mt-3 block space-y-2 text-xs text-muted-foreground">
            <p>
              {shortfall === null
                ? `${operation.asset} balance unavailable. Refresh before sending.`
                : `You need ${shortfall} more ${operation.asset}.`}
            </p>
            {shortfall !== null && operation.asset === "USDC" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    updateDraft(
                      `Swap enough XLM to receive ${shortfall} USDC. Prepare a quote for me to review.`,
                      [],
                    );
                    router.push("/home");
                  }}
                >
                  Get USDC with a swap ↗
                </Button>
                <p>
                  Review and authorize the swap first, then return to approve
                  this transfer.
                </p>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={walletQuery.isFetching || !!busy}
              onClick={() => void walletQuery.refetch()}
            >
              {walletQuery.isFetching ? "Refreshing…" : "Refresh balance"}
            </Button>
          </output>
        )}
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
              <AttachmentTitle>
                {operation.state === "confirmed"
                  ? "Confirmed receipt"
                  : "Transaction status"}
              </AttachmentTitle>
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
        <div className="border-t bg-muted/25 px-4 py-3 sm:px-5">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action("edit");
              }}
            >
              <label className="text-xs" htmlFor={`amount-${operation._id}`}>
                Exact amount · {operation.asset}
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
                className="w-full"
                disabled={!!busy || shortfall !== "0"}
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
      {operation.state === "failed" && !operation.requestId && (
        <div className="border-t px-5 py-4">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => void action("retry")}
          >
            Review again
          </Button>
        </div>
      )}
    </article>
  );
}
