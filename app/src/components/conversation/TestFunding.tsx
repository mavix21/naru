"use client";

import { IconExternalLink, IconPlus, IconRefresh } from "@tabler/icons-react";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { conversationRequest } from "@/lib/conversation/client";
import { displayAmount } from "@/lib/money";
import { fundedPaymentSchema } from "@/lib/smart-account/payments";
import {
  fundingInProgress,
  TEST_FUNDING,
  type Job,
} from "@/lib/smart-account/shared";

import { WalletAddress } from "./WalletAddress";

function FundingStatus({ funding }: { funding: Job }) {
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <output>
          {funding.state === "confirmed"
            ? "XLM added"
            : funding.state === "failed"
              ? "Top-up failed"
              : funding.state === "review"
                ? "Not sent"
                : "Pending"}
        </output>
        {funding.hash && (
          <a
            className="inline-flex items-center gap-1 hover:text-foreground"
            href={`https://stellar.expert/explorer/testnet/tx/${funding.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            Transaction{" "}
            <IconExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>
      {funding.error && (
        <details className="mt-1">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 leading-relaxed">{funding.error}</p>
        </details>
      )}
    </div>
  );
}

export function TestFunding({ userId }: { userId: string }) {
  const query = useAccountStatus(userId);
  const client = useQueryClient();
  const requestId = useRef<string | undefined>(undefined);
  const mutationKey = ["test-funding", userId];
  const busy = useIsMutating({ mutationKey }) > 0;

  const mutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      requestId.current ??= crypto.randomUUID();

      return fundedPaymentSchema.parse(
        await conversationRequest(userId, "/api/payments", {
          action: "fund",
          requestId: requestId.current,
        }),
      );
    },
    onMutate: () =>
      client.cancelQueries({ queryKey: ["conversation-account", userId] }),
    onSuccess: (data) => {
      requestId.current = undefined;
      client.setQueryData(["conversation-account", userId], data);
      void client.invalidateQueries({
        queryKey: ["conversation-account", userId],
      });
    },
    onError: () => {
      // A lost HTTP response may still have funded the wallet. A retry keeps
      // the same intent ID, while this read recovers its actual status.
      void client.invalidateQueries({
        queryKey: ["conversation-account", userId],
      });
    },
  });

  const funding = query.data?.funding;
  const pending = fundingInProgress(funding);

  const showStatus =
    funding &&
    (funding.state !== "confirmed" ||
      mutation.data?.funding?.id === funding.id);

  return (
    <div className="mt-1 border-t pt-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1"
          disabled={busy || pending}
          onClick={() => mutation.mutate()}
        >
          {!busy && !pending && (
            <IconPlus className="size-3.5" aria-hidden="true" />
          )}
          {busy || pending
            ? "Adding XLM…"
            : mutation.error || funding?.state === "failed"
              ? "Retry top-up"
              : `Get ${TEST_FUNDING.label} test XLM`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Refresh balance"
          title="Refresh balance"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <IconRefresh
            className={
              query.isFetching
                ? "size-3.5 motion-safe:animate-spin"
                : "size-3.5"
            }
            aria-hidden="true"
          />
        </Button>
      </div>
      {showStatus && <FundingStatus funding={funding} />}
      {(mutation.error || query.error) && (
        <details className="mt-2 text-xs text-destructive">
          <summary className="cursor-pointer">
            {mutation.error ? "Top-up unavailable" : "Couldn’t refresh balance"}
          </summary>
          <p className="mt-1 leading-relaxed">
            {mutation.error?.message || query.error?.message}
          </p>
        </details>
      )}
    </div>
  );
}

export function FundingResult({
  output,
  userId,
  activation,
}: {
  output: unknown;
  userId: string;
  activation: ReactNode;
}) {
  const parsed = fundedPaymentSchema.safeParse(output);

  if (!parsed.success) {
    if (z.object({ active: z.literal(false) }).safeParse(output).success)
      return activation;

    const error = z.object({ error: z.string() }).safeParse(output);

    if (error.success)
      return (
        <details className="my-3 text-xs text-destructive">
          <summary className="cursor-pointer">Top-up unavailable</summary>
          <p className="mt-1 leading-relaxed">{error.data.error}</p>
        </details>
      );

    return null;
  }

  if (!parsed.data.funding) return null;

  return <FundingReceipt userId={userId} initial={parsed.data} />;
}

function FundingReceipt({
  userId,
  initial,
}: {
  userId: string;
  initial: ReturnType<typeof fundedPaymentSchema.parse>;
}) {
  const query = useAccountStatus(userId, initial.funding!);
  const current = query.data ?? initial;
  const client = useQueryClient();
  const funding = current.funding ?? initial.funding!;

  useEffect(() => {
    // Chat funding can arrive while an already-open balance card still has a
    // pre-deposit snapshot. Refresh the shared account view as status changes.
    void client.invalidateQueries({
      queryKey: ["conversation-account", userId],
      exact: true,
    });
  }, [client, userId, funding.id, funding.state]);

  return (
    <Card size="sm" className="my-3 w-full max-w-sm">
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Test XLM</CardTitle>
          <Badge variant="secondary">Testnet</Badge>
        </div>
        {current.account && <WalletAddress address={current.account} />}
        <FundingStatus funding={funding} />
        {current.balance !== null && (
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3">
            <span className="text-xs text-muted-foreground">Balance</span>
            <span className="text-base font-medium tabular-nums">
              {displayAmount(current.balance)} XLM
            </span>
          </p>
        )}
        {query.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Couldn’t refresh · retrying…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
