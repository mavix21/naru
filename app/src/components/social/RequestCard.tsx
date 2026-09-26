"use client";

import type { Doc, Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";

import { TransferCard } from "@/components/conversation/TransferCard";
import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";

import { CoinDelivery } from "./CoinDelivery";
import { PersonAvatar } from "./Person";
import {
  ActivationReturn,
  requestLabels,
  socialCardClass,
  SplitCard,
} from "./SplitCard";

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
      className={socialCardClass}
      aria-label={`${split.title} payment request`}
    >
      <div className="mb-4 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {event?.kind === "payment_review"
            ? "Your payment review"
            : "Naru to Naru"}
        </span>
        <span>Stellar testnet · XLM</span>
      </div>
      <div className="flex items-center gap-2">
        <PersonAvatar person={event?.actor ?? other} />
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <PersonAvatar person={me} />
      </div>
      <p className="mt-4 text-sm leading-6">
        {event?.kind === "reply" ? (
          <>
            {me.companionName} brought a reply from{" "}
            <strong className="font-medium">{other.displayName}</strong>’s Naru,{" "}
            {other.companionName}.
          </>
        ) : event?.kind === "declined" ? (
          <>{other.displayName} declined this request.</>
        ) : event?.kind === "cancelled" ? (
          <>{other.displayName} cancelled this request.</>
        ) : event?.kind === "paid" ? (
          <>Payment confirmed. {me.companionName} has the receipt.</>
        ) : isOrganizer ? (
          <>
            Your request to{" "}
            <strong className="font-medium">{other.displayName}</strong>, with{" "}
            {other.companionName}.
          </>
        ) : (
          <>
            <strong className="font-medium">{other.displayName}</strong>’s Naru,{" "}
            {other.companionName}, brought {me.companionName} a request.
          </>
        )}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        @{other.username} · {split.title}
      </p>
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
      <p className="mt-5 text-3xl tracking-tight tabular-nums">
        {request.amount}{" "}
        <span className="text-sm text-muted-foreground">XLM</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {split.mode === "collect"
          ? "Collecting before paying"
          : "Reimbursement · organizer says they already paid"}
      </p>
      <output className="mt-4 block text-xs font-medium">
        {requestLabels[request.state]}
      </output>
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
          Confirmed transaction ↗
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
              Pay {request.amount} XLM
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
          Reply
        </Button>
        {!isOrganizer && request.state === "outstanding" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReply("Could we review this split together?")}
          >
            Ask to review
          </Button>
        )}
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
      <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
        A payment request is not proof you accepted a debt. Only confirmed
        transfers count as paid.
      </p>
    </article>
  );
}
