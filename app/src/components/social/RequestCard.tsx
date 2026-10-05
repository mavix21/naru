"use client";

import type { Doc, Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import {
  IconArrowUpRight,
  IconMessage,
  IconReceipt,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";

import { TransferCard } from "@/components/conversation/TransferCard";
import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";

import { CoinDelivery } from "./CoinDelivery";
import { PersonAvatar } from "./Person";
import { RequestStatus } from "./RequestStatus";
import { ActivationReturn, socialCardClass, SplitCard } from "./SplitCard";

export function RequestCard({
  id,
  userId,
  event,
}: {
  id: Id<"paymentRequests">;
  userId: string;
  event?: NonNullable<Doc<"messages">["event"]>;
}) {
  const data = useQuery(api.splits.request, { id });
  const payment = useQuery(api.payments.current);
  const action = useMutation(api.splits.requestAction);
  const prepareReply = useMutation(api.replies.prepare);
  const [reply, setReply] = useState<string>();
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const nonce = useRef<string | null>(null);

  if (!data)
    return (
      <div className={socialCardClass}>
        <output className="text-xs text-muted-foreground">
          Loading request…
        </output>
      </div>
    );
  const { request, split, isOrganizer, me, other, operation } = data;

  async function run<T>(work: () => Promise<T>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t update this request.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="my-4 w-full min-w-0 max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-sm"
      aria-label={`${split.title} payment request`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-[.08em] text-muted-foreground uppercase">
          <IconReceipt className="size-3.5" aria-hidden="true" />
          {event?.kind === "payment_review"
            ? "Payment review"
            : "Split request"}
        </span>
        <RequestStatus state={request.state} />
      </div>
      <h3 className="mt-4 text-sm font-medium break-words">{split.title}</h3>
      <p className="mt-1 break-all text-4xl font-medium tracking-[-.05em] tabular-nums">
        {request.amount}{" "}
        <span className="text-base font-normal tracking-normal text-muted-foreground">
          XLM
        </span>
      </p>
      <div className="mt-4 flex items-center gap-2.5">
        <PersonAvatar person={other} className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-xs">
            <span className="text-muted-foreground">
              {isOrganizer ? "Requested from " : "Requested by "}
            </span>
            <span className="font-medium">{other.displayName}</span>
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            @{other.username}
          </p>
        </div>
      </div>
      {event?.text && (
        <>
          <blockquote
            dir="auto"
            className="mt-4 rounded-2xl bg-muted/40 p-4 text-sm whitespace-pre-wrap break-words"
          >
            {event.text}
          </blockquote>
          <p className="mt-2 text-[10px] text-muted-foreground">
            A message from your friend · not a scheduled payment.
          </p>
        </>
      )}
      <details className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Request details · Testnet</summary>
        <dl className="mt-3 space-y-2 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt>Expense type</dt>
            <dd className="text-foreground">
              {split.mode === "collect"
                ? "Before paying"
                : "Already paid · reimbursement"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Delivered by</dt>
            <dd className="text-foreground">{other.companionName}</dd>
          </div>
        </dl>
      </details>
      {request.state === "paid" && request.hash && (
        <CoinDelivery
          receipt={`${userId}:${request._id}:${request.hash}`}
          from={isOrganizer ? other : me}
          to={isOrganizer ? me : other}
        />
      )}
      {request.hash && (
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${request.hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs underline"
        >
          View payment receipt ↗
        </a>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-3 block text-xs text-muted-foreground">
          {notice}
        </output>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {!isOrganizer &&
          request.state === "outstanding" &&
          (!operation ||
            operation.state === "failed" ||
            operation.state === "cancelled") &&
          (payment?.state === "ready" ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  conversationRequest(userId, "/api/transfers", {
                    action: "request",
                    requestId: id,
                  }),
                )
              }
            >
              Pay my share <IconArrowUpRight aria-hidden="true" />
            </Button>
          ) : (
            <ActivationReturn kind="request" id={id} />
          ))}
        {!isOrganizer && request.state === "outstanding" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => action({ id, action: "decline" }))}
          >
            Decline
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setReview(!review)}>
          {review ? "Hide split" : "Review split"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setReply("")}>
          <IconMessage aria-hidden="true" /> Reply
        </Button>
        {isOrganizer &&
          (request.state === "outstanding" || request.state === "declined") && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => action({ id, action: "cancel" }))}
            >
              Cancel request
            </Button>
          )}
      </div>
      {reply !== undefined && (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              nonce.current ??= crypto.randomUUID();
              await prepareReply({
                requestId: id,
                messageId: nonce.current,
                text: reply,
              });
              nonce.current = null;
              setReply(undefined);
              setNotice(
                "Your reply preview is at the end of this conversation. Confirm it there to share.",
              );
            });
          }}
        >
          <label className="text-xs">
            Reply about {split.title}
            <input
              maxLength={500}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                nonce.current = null;
              }}
              className="mt-2 block w-full rounded-xl border bg-background p-3 text-sm outline-ring"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !reply.trim()}
            className="mt-3"
          >
            Preview reply
          </Button>
        </form>
      )}
      {review && <SplitCard id={split._id} />}
      {!isOrganizer && operation && (
        <TransferCard operation={operation} userId={userId} />
      )}
    </article>
  );
}
