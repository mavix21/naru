"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconMessage,
  IconReceipt,
  IconRefresh,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

import type { PersonIdentity } from "@/components/social/Person";

import { PersonAvatar } from "@/components/social/Person";
import { RequestStatus } from "@/components/social/RequestStatus";
import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";

import { PaySplitRequest } from "./PaySplitRequest";

export function SplitRequestMessage({
  id,
  own,
  friend,
  userId,
  activationPath,
  onReply,
}: {
  id: Id<"paymentRequests">;
  own: boolean;
  friend: PersonIdentity;
  userId: string;
  activationPath: string;
  onReply?: (description: string) => void;
}) {
  const card = useQuery(api.directMessages.requestCard, { id });
  const payment = useQuery(api.splits.paymentStatus, { id });
  const [review, setReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const pending = payment?.state === "submitting";

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      try {
        await conversationRequest(userId, "/api/split-payments", {
          action: "status",
          id,
        });
      } catch {
        if (!disposed)
          setError("Confirmation is still pending. We’ll check again.");
      }

      if (!disposed) timer = setTimeout(() => void check(), 8000);
    };

    void check();

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pending, id, userId]);

  if (!card || !payment)
    return (
      <div
        className="w-80 max-w-full rounded-3xl border border-border/70 bg-card p-5"
        aria-busy="true"
      >
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-5 h-9 w-32 animate-pulse rounded bg-muted" />
        <output className="sr-only">Loading payment request…</output>
      </div>
    );
  const person = own ? friend : card.organizer;
  const state = payment.state;

  const visibleError =
    copyError ??
    (pending ? error : state === "outstanding" ? payment.error : undefined);

  return (
    <article
      aria-label={`${card.description} payment request`}
      className="w-80 max-w-full overflow-hidden rounded-3xl border border-border/70 bg-card text-card-foreground shadow-sm"
    >
      <div className="bg-linear-to-br from-primary/5 via-card to-card p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-[.08em] text-muted-foreground uppercase">
            <IconReceipt className="size-3.5" aria-hidden="true" /> Split
            request
          </span>
          <RequestStatus state={state} />
        </div>
        <h3 className="mt-4 text-sm font-medium break-words">
          {card.description}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 break-all text-4xl font-medium tracking-[-.05em] tabular-nums">
            {card.amount}{" "}
            <span className="text-base font-normal tracking-normal text-muted-foreground">
              {card.asset}
            </span>
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? "Amount copied" : "Copy request amount"}
            title="Copy amount"
            onClick={async () => {
              setCopyError(undefined);

              try {
                await navigator.clipboard.writeText(card.amount);
                setCopied(true);
              } catch {
                setCopyError("Couldn’t copy. Select the amount to copy it.");
              }
            }}
          >
            {copied ? (
              <IconCheck aria-hidden="true" />
            ) : (
              <IconCopy aria-hidden="true" />
            )}
          </Button>
        </div>
        <output className="sr-only">
          {copied ? "Request amount copied." : ""}
        </output>
        <div className="mt-4 flex min-w-0 items-center gap-2.5">
          <PersonAvatar person={person} className="size-8" />
          <div className="min-w-0">
            <p className="truncate text-xs">
              <span className="text-muted-foreground">
                {own ? "Requested from " : "Requested by "}
              </span>
              <span className="font-medium">{person.displayName}</span>
            </p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              @{person.username}
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-border/60 px-5 py-3">
        <details className="group/request-details">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <IconShieldCheck className="size-3.5" aria-hidden="true" />{" "}
              Verified request
            </span>
            <IconChevronDown
              className="size-3.5 transition-transform group-open/request-details:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Expense</dt>
              <dd>Already paid · reimbursement</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Delivered by</dt>
              <dd className="truncate">{card.organizer.companionName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Network</dt>
              <dd>Stellar Testnet</dd>
            </div>
          </dl>
          <a
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            href={`https://stellar.expert/explorer/testnet/tx/${card.creationHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View request receipt{" "}
            <IconArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </details>
      </div>
      {visibleError && (
        <p role="alert" className="px-5 pb-3 text-xs text-destructive">
          {visibleError}
        </p>
      )}
      {state === "paid" && payment.hash && (
        <a
          className="mx-5 mb-4 flex items-center justify-center gap-1.5 rounded-xl bg-success/8 py-2.5 text-xs font-medium text-success"
          href={`https://stellar.expert/explorer/testnet/tx/${payment.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          <IconCheck className="size-3.5" aria-hidden="true" /> View payment
          receipt <IconArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      )}
      {pending && (
        <div className="px-5 pb-4">
          <Button
            className="w-full"
            variant="outline"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setError(undefined);

              try {
                await conversationRequest(userId, "/api/split-payments", {
                  action: "status",
                  id,
                });
              } catch {
                setError("Status unavailable. Your payment remains pending.");
              } finally {
                setChecking(false);
              }
            }}
          >
            <IconRefresh aria-hidden="true" />{" "}
            {checking ? "Checking…" : "Check payment status"}
          </Button>
        </div>
      )}
      {!own && payment.payable && state === "outstanding" && !review && (
        <div className="px-5 pb-4">
          <Button className="w-full" onClick={() => setReview(true)}>
            Pay my share <IconArrowUpRight aria-hidden="true" />
          </Button>
        </div>
      )}
      {!own && payment.payable && state === "outstanding" && review && (
        <PaySplitRequest
          id={id}
          userId={userId}
          amount={card.amount}
          organizer={card.organizer.displayName}
          intent={payment.intent}
          activationPath={activationPath}
          onClose={() => setReview(false)}
        />
      )}
      {onReply && !review && (
        <div className="px-5 pb-3">
          <Button
            className="w-full"
            variant="ghost"
            size="sm"
            onClick={() => onReply(card.description)}
          >
            <IconMessage aria-hidden="true" />{" "}
            {own ? "Message friend" : "Reply about this split"}
          </Button>
        </div>
      )}
    </article>
  );
}
