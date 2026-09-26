"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { usePayments } from "@/hooks/usePayments";
import { formatBalance } from "@/lib/smart-account/shared";
import { cn } from "@/lib/utils";

const tones = {
  ready: "bg-primary",
  pending: "bg-muted-foreground",
  rejected: "bg-destructive",
  inactive: "bg-border",
  passkey: "bg-muted-foreground",
} as const;

function ActivationPaymentCard({
  status,
  message,
  tone = "inactive",
  failure,
  transaction,
  primary,
  onPrimary,
  primaryDisabled = false,
  later,
  onLater,
  laterDisabled = false,
}: {
  status: string;
  message: string;
  tone?: keyof typeof tones;
  failure?: string;
  transaction?: string;
  primary: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  later: string;
  onLater?: () => void;
  laterDisabled?: boolean;
}) {
  return (
    <Card className="h-88" aria-label="Payment activation">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <span
              className={cn(
                "mr-2 inline-block size-2 rounded-full",
                tones[tone],
              )}
              aria-hidden="true"
            />
            Payments
          </CardTitle>
          <Badge variant="outline">Testnet</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-between">
        <div className="min-h-0">
          <p className="text-lg font-medium" aria-live="polite">
            {status}
          </p>
          <p className="mt-2 h-12 overflow-y-auto text-sm text-muted-foreground">
            {message}
          </p>
          <div className="mt-2 h-12 overflow-y-auto text-xs">
            {failure && (
              <p className="break-words text-destructive" role="alert">
                {failure}
              </p>
            )}
            {transaction && (
              <a
                className="underline underline-offset-4"
                href={`https://stellar.expert/explorer/testnet/tx/${transaction}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={primaryDisabled || !onPrimary}
            onClick={onPrimary}
          >
            {primary}
          </Button>
          {later ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={laterDisabled || !onLater}
              onClick={onLater}
            >
              {later}
            </Button>
          ) : (
            <div className="h-8" aria-hidden="true" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ActivationPaymentsLoading({
  slow = false,
}: {
  slow?: boolean;
}) {
  return (
    <ActivationPaymentCard
      status={slow ? "Still checking" : "Checking payments…"}
      message={slow ? "Please try again." : "Checking your account."}
      primary={slow ? "Try again" : "Checking…"}
      onPrimary={slow ? () => window.location.reload() : undefined}
      later="Later"
    />
  );
}

export function Payments({
  userId,
  onContinue,
  leaving = false,
  leaveError,
}: {
  userId: string;
  onContinue?: () => void;
  leaving?: boolean;
  leaveError?: string;
}) {
  const { payment, loading, query, error, confirming, activate } =
    usePayments(userId);

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const state = payment?.state ?? "inactive";
  const account = payment?.account ?? null;
  const busy = activate.isPending || leaving;
  const submitted = payment?.job?.state === "pending";
  const preparing = state === "pending" && !submitted;
  const unavailable = !loading && query.isError && !payment;

  if (onContinue) {
    const ready = state === "ready" && Boolean(account);

    const status = loading
      ? "Checking payments…"
      : unavailable
        ? "Can’t check payments"
        : ready
          ? "Payments are ready"
          : state === "pending"
            ? submitted
              ? "Almost there"
              : "Preparing payments"
            : state === "rejected"
              ? "Let’s try again"
              : state === "passkey"
                ? "Finish activation"
                : "Payments are optional";

    const message = loading
      ? "Checking your account."
      : unavailable
        ? "Try checking again."
        : ready
          ? "Your account is ready to use."
          : state === "pending"
            ? submitted
              ? "Waiting for confirmation."
              : "Your account is being prepared."
            : state === "rejected"
              ? "Retry whenever you’re ready."
              : state === "passkey"
                ? "Continue with your passkey."
                : "Use a passkey on your device.";

    const primary = leaving
      ? "Opening home…"
      : ready
        ? "Go home"
        : loading
          ? "Checking…"
          : unavailable
            ? "Try again"
            : submitted
              ? "Check status"
              : activate.isPending
                ? confirming
                  ? "Confirm on device…"
                  : "Activating…"
                : state === "pending" || state === "passkey"
                  ? "Resume activation"
                  : state === "rejected"
                    ? "Retry activation"
                    : "Activate payments";

    return (
      <ActivationPaymentCard
        status={status}
        message={message}
        tone={loading || unavailable ? "inactive" : state}
        failure={
          leaveError ??
          error ??
          payment?.job?.error ??
          (query.isError ? query.error.message : undefined)
        }
        transaction={payment?.job?.hash ?? undefined}
        primary={primary}
        onPrimary={
          ready
            ? onContinue
            : unavailable || submitted
              ? () => void query.refetch()
              : loading
                ? undefined
                : () => activate.mutate()
        }
        primaryDisabled={
          leaving ||
          activate.isPending ||
          (query.isFetching && (unavailable || submitted))
        }
        later={ready ? "" : leaving ? "Opening home…" : "Later"}
        onLater={onContinue}
        laterDisabled={loading || busy}
      />
    );
  }

  const title = loading
    ? "Checking payments…"
    : unavailable
      ? "Status unavailable"
      : state === "ready"
        ? "Payments are ready"
        : state === "pending"
          ? submitted
            ? "Activation pending"
            : "Preparing payments…"
          : state === "rejected"
            ? "Activation rejected"
            : state === "passkey"
              ? "Activation unfinished"
              : "Payments are inactive";

  const action = activate.isPending
    ? confirming
      ? "Confirm in your device…"
      : "Activating…"
    : state === "pending"
      ? "Resume activation"
      : state === "rejected"
        ? "Retry activation"
        : "Activate payments";

  return (
    <>
      <Card aria-label="Payment account">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>
              <span
                className={cn(
                  "mr-2 inline-block size-2 rounded-full align-middle",
                  loading
                    ? "animate-pulse bg-muted-foreground motion-reduce:animate-none"
                    : tones[state],
                )}
                aria-hidden="true"
              />
              {title}
            </CardTitle>
            <Badge variant="outline">Stellar testnet</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <output className="text-sm text-muted-foreground">
              Reading your saved account status.
            </output>
          )}

          {unavailable && (
            <div className="flex flex-col items-start gap-3">
              <Alert variant="destructive">
                <AlertDescription>{query.error.message}</AlertDescription>
              </Alert>
              <Button
                type="button"
                variant="secondary"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching ? "Checking…" : "Retry status"}
              </Button>
            </div>
          )}

          {!loading && !unavailable && state === "ready" && account && (
            <div className="flex flex-col gap-5">
              {query.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{query.error.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Test balance
                </span>
                {payment?.balance !== null && payment?.balance !== undefined ? (
                  <p className="text-3xl font-semibold tracking-tight">
                    {formatBalance(payment.balance).replace(/\.?0+$/, "")}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      XLM
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {payment?.balanceError || "Balance unavailable."}
                  </p>
                )}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  Payment account
                </span>
                <code className="block truncate rounded-2xl bg-muted px-3 py-2 text-xs">
                  {account}
                </code>
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(account);
                        setCopied(true);
                        setCopyError(false);
                      } catch {
                        setCopyError(true);
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy address"}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    {query.isFetching ? "Refreshing…" : "Refresh balance"}
                  </Button>
                </div>
                {copyError && (
                  <output className="text-xs text-muted-foreground">
                    Select the address above to copy it.
                  </output>
                )}
              </div>
              {onContinue && (
                <div>
                  <Button
                    type="button"
                    size="lg"
                    disabled={leaving}
                    onClick={onContinue}
                  >
                    {leaving ? "Opening home…" : "Go home"}{" "}
                    <span aria-hidden="true">→</span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {!loading && !unavailable && state !== "ready" && (
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm text-muted-foreground">
                {state === "pending"
                  ? submitted
                    ? "Waiting for network confirmation. Your account is saved; this may take a moment."
                    : preparing
                      ? "Your saved account is being prepared. Check back in a moment."
                      : "Your passkey is saved. Resume to finish activating payments."
                  : state === "rejected"
                    ? "Nothing is ready yet. Retry the same account when you’re ready."
                    : "Protect payments with your device’s passkey. No wallet connection, seed phrase, or extension."}
              </p>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {payment?.job?.error && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Activation details
                  </summary>
                  <p className="mt-2 break-words">{payment.job.error}</p>
                </details>
              )}
              {payment?.job?.hash && (
                <a
                  className="text-xs underline underline-offset-4"
                  href={`https://stellar.expert/explorer/testnet/tx/${payment.job.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
              {activate.isPending && (
                <output className="text-xs text-muted-foreground">
                  {confirming
                    ? "Confirm your passkey to finish."
                    : "Preparing your passkey and account…"}
                </output>
              )}
              {submitted ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {query.isFetching ? "Checking…" : "Check status"}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  disabled={busy}
                  onClick={() => activate.mutate()}
                >
                  {action}
                  {!activate.isPending && <span aria-hidden="true">↗</span>}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {onContinue && !loading && state !== "ready" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={busy}
          onClick={onContinue}
        >
          {leaving ? "Opening home…" : "Later"}
        </Button>
      )}
    </>
  );
}
