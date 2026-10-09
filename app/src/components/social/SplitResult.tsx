"use client";

import type { Doc, Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconMessage,
  IconReceipt,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { useState } from "react";

import { openChat } from "@/components/messaging/navigation";
import { Button } from "@/components/ui/button";
import { displayAmount } from "@/lib/money";

import { PersonAvatar } from "./Person";
import { PublishSplit } from "./PublishSplit";
import { RequestStatus } from "./RequestStatus";

export function SplitResult({
  split,
  requests,
  isOrganizer,
}: {
  split: Doc<"splits">;
  requests: Doc<"paymentRequests">[];
  isOrganizer: boolean;
}) {
  const startChat = useMutation(api.directMessages.start);
  const cancel = useMutation(api.splits.requestAction);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const requested = split.shares.reduce(
    (sum, share) =>
      share.person.userId === split.organizer.userId
        ? sum
        : sum + BigInt(share.units),
    BigInt(0),
  );

  const received = requests.reduce(
    (sum, request) =>
      request.state === "paid" ? sum + BigInt(request.units) : sum,
    BigInt(0),
  );

  const paid = requests.filter((request) => request.state === "paid").length;

  const progress =
    requested > BigInt(0)
      ? Number((received * BigInt(10_000)) / requested) / 100
      : 0;

  const delivered = split.state === "sent";

  async function act(id: Id<"profiles">, requestId?: Id<"paymentRequests">) {
    if (busy) return;
    setBusy(id);
    setError(undefined);

    try {
      if (requestId) await cancel({ id: requestId, action: "cancel" });
      else openChat(await startChat({ friendId: id }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This action couldn’t finish. Try again.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <article
      aria-label={`${split.title} split result`}
      className="my-4 w-full min-w-0 max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
    >
      <div className="bg-linear-to-br from-primary/5 via-card to-card p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-[.08em] text-muted-foreground uppercase">
            <IconReceipt className="size-3.5" aria-hidden="true" /> Shared
            expense
          </span>
          <span className="rounded-full bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">
            Testnet
          </span>
        </div>
        <h3 className="mt-4 text-lg font-medium tracking-tight break-words">
          {split.title}
        </h3>
        <p className="mt-1 break-all text-4xl font-medium tracking-[-.05em] tabular-nums">
          {split.total}{" "}
          <span className="text-base font-normal tracking-normal text-muted-foreground">
            {split.asset}
          </span>
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {split.shares.slice(0, 4).map((share) => (
                <PersonAvatar
                  key={share.person.userId}
                  person={share.person}
                  className="size-7 ring-2 ring-card"
                />
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {split.shares.length} people
            </span>
          </div>
          <output className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
            {delivered && <IconCheck className="size-3.5" aria-hidden="true" />}
            {delivered
              ? "Requests sent"
              : split.state === "published"
                ? "Delivering…"
                : "Publishing…"}
          </output>
        </div>
      </div>
      <div className="border-y border-border/60 bg-muted/20 px-5 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground">Collected</p>
            <p className="mt-1 text-lg font-medium tabular-nums">
              {displayAmount(received.toString())}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {split.asset}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Requested</p>
            <p className="mt-1 text-sm tabular-nums">
              {displayAmount(requested.toString())}{" "}
              <span className="text-xs text-muted-foreground">
                {split.asset}
              </span>
            </p>
          </div>
        </div>
        <progress
          max={100}
          value={progress}
          aria-label="Share of requested funds collected"
          className="mt-3 block h-1.5 w-full overflow-hidden rounded-full border-0 bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {paid} of {split.participantIds.length} requests paid
        </p>
      </div>
      <div className="px-5 py-4">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium tracking-[.06em] text-muted-foreground uppercase">
          <IconUsers className="size-3.5" aria-hidden="true" /> Equal shares
        </div>
        <div className="divide-y divide-border/50">
          {split.shares.map((share) => {
            const request = requests.find(
              (row) => row.participantId === share.person.userId,
            );

            const ownShare = share.person.userId === split.organizer.userId;

            return (
              <div
                key={share.person.userId}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 py-3"
              >
                <PersonAvatar person={share.person} className="size-9" />
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ownShare && isOrganizer
                        ? "You"
                        : share.person.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {ownShare
                        ? "Organizer · own share"
                        : `@${share.person.username}`}
                    </p>
                  </div>
                  <p className="text-right text-sm font-medium whitespace-nowrap tabular-nums">
                    {displayAmount(share.units)}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {split.asset}
                    </span>
                  </p>
                  <div className="flex min-h-7 items-center">
                    {request ? (
                      <RequestStatus state={request.state} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {ownShare ? "Not requested" : "Awaiting delivery"}
                      </span>
                    )}
                  </div>
                  <div className="flex min-h-7 items-center justify-end gap-1">
                    {!ownShare && isOrganizer && (
                      <>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!!busy}
                          aria-label={`Open chat with ${share.person.displayName}`}
                          title="Open chat"
                          onClick={() => void act(share.person.userId)}
                        >
                          <IconMessage aria-hidden="true" />
                        </Button>
                        {split.asset === "XLM" &&
                          request &&
                          (request.state === "outstanding" ||
                            request.state === "declined") && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={!!busy}
                              aria-label={`Cancel request for ${share.person.displayName}`}
                              title="Cancel request"
                              onClick={() =>
                                void act(share.person.userId, request._id)
                              }
                            >
                              <IconX aria-hidden="true" />
                            </Button>
                          )}
                      </>
                    )}
                    {request?.hash && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${request.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${share.person.displayName}’s payment receipt`}
                        className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-ring hover:bg-muted hover:text-primary"
                      >
                        <IconArrowUpRight
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <details className="group/split-details border-t border-border/60 px-5 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
          Split details{" "}
          <IconChevronDown
            className="size-3.5 transition-transform group-open/split-details:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="mt-3 space-y-2 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Organized by</dt>
            <dd className="truncate">{split.organizer.displayName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Expense type</dt>
            <dd>
              {split.mode === "reimburse"
                ? "Already paid · reimbursement"
                : "Collecting before paying"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Network</dt>
            <dd>Stellar Testnet</dd>
          </div>
        </dl>
        {split.asset === "USDC" && <PublishSplit split={split} />}
      </details>
    </article>
  );
}
