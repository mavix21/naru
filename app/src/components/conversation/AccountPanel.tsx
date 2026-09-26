"use client";

import { api } from "@naru/backend/api";
import { useQuery } from "@tanstack/react-query";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";
import { displayAmount } from "@/lib/money";
import { paymentStateSchema } from "@/lib/smart-account/payments";
import { jobSchema, type Job } from "@/lib/smart-account/shared";

const accountSchema = paymentStateSchema.extend({
  funding: jobSchema.nullable(),
});

export function AccountPanel({
  userId,
  preloaded,
}: {
  userId: string;
  preloaded: Preloaded<typeof api.payments.current>;
}) {
  const payment = usePreloadedQuery(preloaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [requestedFunding, setRequestedFunding] = useState<Job>();

  const query = useQuery({
    queryKey: ["conversation-account", userId],
    queryFn: async () =>
      accountSchema.parse(await conversationRequest(userId, "/api/payments")),
    refetchOnWindowFocus: true,
    refetchInterval: (current) =>
      current.state.data?.funding?.state === "pending" ||
      current.state.data?.state === "pending"
        ? 6000
        : false,
  });

  const funding = query.data?.funding ?? requestedFunding;

  return (
    <div className="text-sm">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-medium">Your account</h2>
        <span className="text-[10px] text-muted-foreground">
          Stellar testnet
        </span>
      </div>
      {payment?.state === "ready" && payment.account ? (
        <>
          <span className="text-xs text-muted-foreground">
            Test balance · last checked
          </span>
          <p className="mt-2 text-3xl tracking-tight tabular-nums">
            {payment.balance !== null ? displayAmount(payment.balance) : "—"}{" "}
            <span className="text-sm text-muted-foreground">XLM</span>
          </p>
          {payment.balanceError && (
            <p className="mt-2 text-xs text-muted-foreground">
              {payment.balanceError}
            </p>
          )}
          <code className="mt-5 block break-all rounded-xl bg-muted/60 p-3 text-[10px] leading-relaxed">
            {payment.account}
          </code>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payment.account!);
                  setCopied(true);
                } catch {
                  setError("Select the account address to copy it.");
                }
              }}
            >
              {copied ? "Copied" : "Copy account"}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={busy || query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? "Checking…" : "Refresh balance"}
            </Button>
          </div>
          <div className="mt-5 border-t pt-4">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              A one-time 5 test XLM grant lets you try your first transfer.
              Network fees are sponsored by Naru.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);

                try {
                  const result = await conversationRequest<{
                    funding: unknown;
                  }>(userId, "/api/payments", { action: "fund" });

                  const job = jobSchema.parse(result.funding);
                  setRequestedFunding(job);
                  void query.refetch();

                  if (job.state === "failed")
                    setError(
                      job.error || "Test funding failed. Please try again.",
                    );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Test funding is unavailable.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Checking…"
                : funding
                  ? "Check test funding"
                  : "Add test XLM"}
            </Button>
            {funding && (
              <output className="mt-3 block text-xs text-muted-foreground">
                {funding.state === "confirmed"
                  ? "Test funding confirmed."
                  : funding.state === "failed"
                    ? "Test funding failed."
                    : "Test funding is awaiting confirmation."}{" "}
                {funding.hash && (
                  <a
                    className="underline"
                    href={`https://stellar.expert/explorer/testnet/tx/${funding.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                )}
              </output>
            )}
          </div>
        </>
      ) : (
        <div>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            {payment?.state === "pending"
              ? "Your payment account is being activated."
              : "Add a passkey whenever you’re ready to send money. Your conversation stays right here."}
          </p>
          <Button render={<Link href="/activate" />} nativeButton={false}>
            {" "}
            {payment ? "Continue activation" : "Activate payments"} ↗
          </Button>
        </div>
      )}
      {(error || query.error) && (
        <p
          role="alert"
          className="mt-4 text-xs leading-relaxed text-destructive"
        >
          {error || query.error?.message}
        </p>
      )}
    </div>
  );
}
