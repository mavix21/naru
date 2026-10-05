"use client";

import type { Doc } from "@naru/backend/data-model";

import { useAuth } from "@clerk/nextjs";
import { IconCheck, IconFingerprint, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";
import { creationReviewSchema } from "@/lib/splits/policy";

export function PublishSplit({
  split,
  onBusyChange,
}: {
  split: Doc<"splits">;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { userId } = useAuth();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const pending = split.state === "submitting" || split.state === "published";

  useEffect(() => {
    if (!userId || (!pending && split.state !== "sent")) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      try {
        await conversationRequest(userId, "/api/splits", {
          action: "status",
          id: split._id,
          revision: split.revision,
        });

        if (!disposed) setError(undefined);
      } catch {
        if (!disposed)
          setError(
            pending
              ? "Confirmation or delivery is still pending. Your saved publication will be checked again."
              : "The storage check is unavailable. Your published requests remain saved; reopen this review to retry.",
          );
      }

      if (!disposed && pending) timer = setTimeout(() => void refresh(), 8000);
    };

    void refresh();

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [userId, pending, split._id, split.revision, split.state]);

  async function publish() {
    if (busy || !userId) return;
    setError(undefined);
    setBusy("Opening passkey…");
    onBusyChange?.(true);
    let submitting = false;

    try {
      if (!navigator.locks)
        throw new Error("Use a current browser with passkey support.");
      await navigator.locks.request(
        `naru:split:${split._id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("This split is open in another tab.");

          const { NaruSmartAccount } =
            await import("@/lib/smart-account/adapter");

          const account = await NaruSmartAccount.open("/api/payments", userId);
          await account.restore();

          const result = await conversationRequest<{ review?: unknown }>(
            userId,
            "/api/splits",
            {
              action: "review",
              id: split._id,
              revision: split.revision,
            },
          );

          if (!result.review) return;
          const review = creationReviewSchema.parse(result.review);

          if (
            !split.creation ||
            !split.organizerAccount ||
            split.shares.some((s) => !s.account)
          )
            throw new Error("Save and review the participant accounts first.");
          setBusy("Approve with passkey…");

          const auth = await account.signCreation(review, {
            account: split.organizerAccount,
            splitId: split.creation.id,
            units: split.units,
            participants: split.shares.map((s) => s.account!),
          });

          submitting = true;
          setBusy("Sending requests…");
          await conversationRequest(userId, "/api/splits", {
            action: "authorize",
            id: split._id,
            revision: split.revision,
            reviewId: review.id,
            auth,
          });
        },
      );
    } catch (cause) {
      setError(
        submitting
          ? "Submission could not be confirmed. Check publication status before trying again."
          : cause instanceof Error &&
              /NotAllowed|cancel|denied|timed out/i.test(
                `${cause.name} ${cause.message}`,
              )
            ? "Passkey not authorized. No publication was submitted."
            : cause instanceof Error
              ? cause.message
              : "Couldn’t publish this split.",
      );
    } finally {
      setBusy(undefined);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-2">
      {split.state === "draft" ? (
        <Button
          className="w-full"
          disabled={!!busy || !userId}
          onClick={() => void publish()}
        >
          {busy ? (
            <IconLoader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <IconFingerprint aria-hidden="true" />
          )}
          {busy ??
            `Send ${split.participantIds.length} ${split.participantIds.length === 1 ? "request" : "requests"}`}
        </Button>
      ) : (
        <output className="block pt-3">
          <Badge variant="secondary">
            {split.state === "sent" ? (
              <IconCheck aria-hidden="true" />
            ) : (
              <IconLoader2 className="animate-spin" aria-hidden="true" />
            )}
            {split.state === "sent"
              ? "Requests delivered"
              : split.state === "published"
                ? "Confirmed · delivering…"
                : "Publication pending"}
          </Badge>
        </output>
      )}
      {(error || split.creation?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error ?? split.creation?.error}
        </p>
      )}
      {split.creation?.hash && (
        <a
          className="block break-all text-xs underline"
          target="_blank"
          rel="noreferrer"
          href={`https://stellar.expert/explorer/testnet/tx/${split.creation.hash}`}
        >
          View transaction ↗
        </a>
      )}
      {split.state === "draft" && (
        <p className="text-center text-[11px] text-muted-foreground">
          Passkey approval · requests only, no money moved
        </p>
      )}
    </div>
  );
}
