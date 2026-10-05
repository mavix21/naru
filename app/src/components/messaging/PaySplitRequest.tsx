"use client";

import type { Id } from "@naru/backend/data-model";

import {
  IconArrowUpRight,
  IconFingerprint,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import type { SharePaymentIntent } from "@/lib/splits/policy";

import { Button } from "@/components/ui/button";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useMessageDraft } from "@/hooks/useMessageDraft";
import { conversationRequest } from "@/lib/conversation/client";
import { displayAmount, parseAmount, transferShortfall } from "@/lib/money";
import { sharePaymentReviewSchema } from "@/lib/splits/policy";

import { openChat } from "./navigation";

export function PaySplitRequest({
  id,
  userId,
  amount,
  organizer,
  intent,
  activationPath,
  onClose,
}: {
  id: Id<"paymentRequests">;
  userId: string;
  amount: string;
  organizer: string;
  intent: SharePaymentIntent;
  activationPath: string;
  onClose: () => void;
}) {
  const wallet = useAccountStatus(userId);
  const { draft, updateDraft } = useMessageDraft(userId);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const balance = wallet.isError ? null : (wallet.data?.usdcBalance ?? null);
  const shortfall = transferShortfall(intent.units, balance);

  const active =
    wallet.data?.state === "ready" && wallet.data.account === intent.account;

  async function pay() {
    if (busy) return;
    setBusy("Preparing payment…");
    setError(undefined);
    let submitted = false;

    try {
      if (parseAmount(amount, "USDC").units !== intent.units)
        throw new Error("The payment amount changed. Reopen this request.");

      if (!navigator.locks)
        throw new Error("Use a current browser with passkey support.");
      await navigator.locks.request(
        `naru:split-payment:${id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("This payment is open in another tab.");

          const { NaruSmartAccount } =
            await import("@/lib/smart-account/adapter");

          const account = await NaruSmartAccount.open("/api/payments", userId);
          await account.restore();

          const result = await conversationRequest<{ review?: unknown }>(
            userId,
            "/api/split-payments",
            { action: "review", id },
          );

          if (!result.review) return;
          const review = sharePaymentReviewSchema.parse(result.review);
          setBusy("Approve with passkey…");
          const auth = await account.signSharePayment(review, intent);
          submitted = true;
          setBusy("Confirming payment…");
          await conversationRequest(userId, "/api/split-payments", {
            action: "authorize",
            id,
            reviewId: review.id,
            auth,
          });
        },
      );
    } catch (cause) {
      if (submitted) setUncertain(true);
      setError(
        submitted
          ? "Payment status is unknown. Check status before trying again."
          : cause instanceof Error &&
              /NotAllowed|cancel|denied|timed out/i.test(
                `${cause.name} ${cause.message}`,
              )
            ? "Passkey approval cancelled. No payment was sent."
            : cause instanceof Error
              ? cause.message
              : "Payment unavailable. Please try again.",
      );
    } finally {
      setBusy(undefined);
      void wallet.refetch();
    }
  }

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Review your payment</h4>
        <Button variant="ghost" size="xs" disabled={!!busy} onClick={onClose}>
          Back
        </Button>
      </div>
      <dl className="space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">To</dt>
          <dd className="truncate font-medium">{organizer}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Your share</dt>
          <dd className="font-medium tabular-nums">{amount} USDC</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">USDC balance</dt>
          <dd className="tabular-nums">
            {balance === null
              ? "Unavailable"
              : `${displayAmount(balance)} USDC`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Network fee</dt>
          <dd>Paid by Naru</dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {uncertain ? (
        <Button
          className="w-full"
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            setBusy("Checking status…");

            try {
              await conversationRequest(userId, "/api/split-payments", {
                action: "status",
                id,
              });
              setUncertain(false);
              setError(undefined);
            } catch {
              setError("Status unavailable. Check again before paying.");
            } finally {
              setBusy(undefined);
            }
          }}
        >
          <IconRefresh aria-hidden="true" /> {busy ?? "Check payment status"}
        </Button>
      ) : wallet.isPending ? (
        <Button className="w-full" disabled>
          <IconLoader2
            className="motion-safe:animate-spin"
            aria-hidden="true"
          />{" "}
          Checking wallet…
        </Button>
      ) : !active && !wallet.isError ? (
        <Button className="w-full" render={<Link href={activationPath} />}>
          Activate payments <IconArrowUpRight aria-hidden="true" />
        </Button>
      ) : shortfall === null ? (
        <Button
          className="w-full"
          variant="outline"
          disabled={wallet.isFetching}
          onClick={() => void wallet.refetch()}
        >
          <IconRefresh aria-hidden="true" /> Refresh balance
        </Button>
      ) : shortfall !== "0" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            You need {shortfall} more USDC.
          </p>
          <Button
            className="w-full"
            onClick={() => {
              if (!draft.trim())
                updateDraft(`Swap XLM for ${shortfall} USDC.`, []);
              openChat("naru");
            }}
          >
            Get USDC <IconArrowUpRight aria-hidden="true" />
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            Review a swap with Naru, then return to pay.
          </p>
        </div>
      ) : (
        <Button className="w-full" disabled={!!busy} onClick={() => void pay()}>
          {busy ? (
            <IconLoader2
              className="motion-safe:animate-spin"
              aria-hidden="true"
            />
          ) : (
            <IconFingerprint aria-hidden="true" />
          )}
          {busy ?? `Confirm & pay ${amount} USDC`}
        </Button>
      )}
      <p className="text-center text-[10px] text-muted-foreground">
        Stellar Testnet · approved with your passkey
      </p>
    </div>
  );
}
