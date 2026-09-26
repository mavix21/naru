"use client";

import type { Doc, Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { displayAmount, equalShares } from "@/lib/money";

import { Person } from "./Person";

export const requestLabels = {
  outstanding: "Outstanding",
  submitting: "Transaction pending",
  paid: "Paid · confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
} as const;

export const socialCardClass =
  "my-5 w-full min-w-0 overflow-hidden rounded-3xl border border-border/80 bg-card p-5 shadow-xs md:p-6";

export function ActivationReturn({
  kind,
  id,
}: {
  kind: "request" | "split";
  id: string;
}) {
  return (
    <Link
      href={`/activate?returnTo=${encodeURIComponent(`/home?${kind}=${id}`)}`}
      className="mt-3 inline-block text-xs font-medium underline underline-offset-4"
    >
      Activate payments, then return here ↗
    </Link>
  );
}

function SplitDraft({ split }: { split: Doc<"splits"> }) {
  const social = useQuery(api.social.current);
  const payment = useQuery(api.payments.current);
  const edit = useMutation(api.splits.edit);
  const confirm = useMutation(api.splits.confirm);
  const [title, setTitle] = useState(split.title);
  const [total, setTotal] = useState(split.total);
  const [includeSelf, setIncludeSelf] = useState(split.includeSelf);
  const [mode, setMode] = useState(split.mode);
  const [ids, setIds] = useState(split.participantIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const dirty =
    title !== split.title ||
    total !== split.total ||
    includeSelf !== split.includeSelf ||
    mode !== split.mode ||
    ids.join() !== split.participantIds.join();

  let calculation: ReturnType<typeof equalShares> = [];
  let invalid: string | undefined;

  try {
    calculation = equalShares(total, [
      ...ids,
      ...(includeSelf ? [split.organizer.userId] : []),
    ]);
  } catch (cause) {
    invalid = cause instanceof Error ? cause.message : "Check the total.";
  }

  const identities = [
    split.organizer,
    ...split.shares.map((s) => s.person),
    ...(social?.friends.map((f) => f.person) ?? []),
  ];

  const requested = calculation
    .filter((s) => s.userId !== split.organizer.userId)
    .reduce((sum, s) => sum + BigInt(s.units), BigInt(0));

  async function save(send: boolean) {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      if (send) await confirm({ id: split._id, revision: split.revision });
      else
        await edit({
          id: split._id,
          revision: split.revision,
          title,
          total,
          includeSelf,
          mode,
          participantIds: ids,
        });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t save this split.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <label className="block text-xs">
        What’s it for?
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          className="mt-2 block w-full rounded-xl border bg-background px-3 py-2 text-sm outline-ring"
        />
      </label>
      <label className="block text-xs">
        Total · XLM
        <input
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          inputMode="decimal"
          maxLength={40}
          className="mt-2 block w-full rounded-xl border bg-background px-3 py-2 text-xl tabular-nums outline-ring"
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs">Participants</legend>
        {social?.friends.map(({ person }) => (
          <label
            key={person.userId}
            className="flex items-center gap-3 rounded-xl py-1"
          >
            <input
              type="checkbox"
              checked={ids.includes(person.userId)}
              onChange={(e) =>
                setIds(
                  e.target.checked
                    ? [...ids, person.userId]
                    : ids.filter((id) => id !== person.userId),
                )
              }
              className="size-4 accent-primary"
            />
            <Person person={person} />
          </label>
        ))}
        {social &&
          ids.flatMap((id) =>
            social.friends.some((friend) => friend.person.userId === id)
              ? []
              : [
                  <label
                    key={id}
                    className="flex items-center gap-3 py-1 text-xs text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setIds(ids.filter((selected) => selected !== id))
                      }
                      className="size-4 accent-primary"
                    />
                    {identities.find((person) => person.userId === id)
                      ?.displayName ?? "Selected person"}{" "}
                    · no longer friends; remove to continue
                  </label>,
                ],
          )}
      </fieldset>
      <label className="flex items-center justify-between gap-4 rounded-2xl bg-muted/40 p-3 text-sm">
        <span>
          Include my share
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Your share stays with you. No request to yourself.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={includeSelf}
          checked={includeSelf}
          onChange={(e) => setIncludeSelf(e.target.checked)}
          className="size-5 accent-primary"
        />
      </label>
      <fieldset className="space-y-2 text-xs">
        <legend className="mb-2">When is this expense paid?</legend>
        <label className="flex gap-2">
          <input
            type="radio"
            name={`mode-${split._id}`}
            checked={mode === "collect"}
            onChange={() => setMode("collect")}
          />
          Collecting before paying
        </label>
        <label className="flex gap-2">
          <input
            type="radio"
            name={`mode-${split._id}`}
            checked={mode === "reimburse"}
            onChange={() => setMode("reimburse")}
          />
          Reimbursement · I already paid
        </label>
      </fieldset>
      <div className="space-y-2 border-t pt-4">
        {calculation.map((share) => (
          <div
            key={share.userId}
            className="flex justify-between gap-3 text-xs"
          >
            <span>
              {share.userId === split.organizer.userId
                ? "You"
                : (identities.find((p) => p.userId === share.userId)
                    ?.displayName ?? "Friend")}
            </span>
            <span className="tabular-nums">
              {displayAmount(share.units)} XLM
            </span>
          </div>
        ))}
        <p className="pt-2 text-xs font-medium">
          Requesting {displayAmount(requested.toString())} XLM from {ids.length}{" "}
          {ids.length === 1 ? "friend" : "friends"}.
        </p>
        <p className="text-[10px] leading-5 text-muted-foreground">
          Equal shares. Any remaining smallest units go in stable user-ID order.
        </p>
      </div>
      {(error || invalid) && (
        <p role="alert" className="text-xs text-destructive">
          {error || invalid}
        </p>
      )}
      <Button
        disabled={
          busy ||
          !!invalid ||
          !ids.length ||
          (!dirty && payment?.state !== "ready")
        }
        onClick={() => void save(!dirty)}
      >
        {busy
          ? "Saving…"
          : dirty
            ? "Save review changes"
            : `Send ${ids.length} ${ids.length === 1 ? "request" : "requests"}`}
      </Button>
      {(payment && payment.state !== "ready") || payment === null ? (
        <ActivationReturn kind="split" id={split._id} />
      ) : null}
      <p className="text-[10px] leading-5 text-muted-foreground">
        Shared only after confirmation. This is a payment request, not an
        accepted debt.
      </p>
    </div>
  );
}

export function SplitCard({ id }: { id: Id<"splits"> }) {
  const data = useQuery(api.splits.get, { id });
  const action = useMutation(api.splits.requestAction);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!data)
    return (
      <div className={socialCardClass}>
        <output className="text-xs text-muted-foreground">
          Loading split…
        </output>
      </div>
    );
  const { split, requests, isOrganizer } = data;

  return (
    <article className={socialCardClass} aria-label={`${split.title} split`}>
      <div className="mb-5 flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {split.state === "draft" ? "Review a split" : "Shared expense"}
        </span>
        <span>Stellar testnet · XLM</span>
      </div>
      {split.state === "draft" ? (
        <SplitDraft key={split.revision} split={split} />
      ) : (
        <>
          <h3 className="text-lg tracking-tight">{split.title}</h3>
          <p className="mt-2 text-3xl tracking-tight tabular-nums">
            {split.total}{" "}
            <span className="text-sm text-muted-foreground">XLM</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {split.mode === "reimburse"
              ? "Reimbursement · organizer says they already paid"
              : "Collecting before paying"}
          </p>
          <div className="mt-5 space-y-4">
            {split.shares.map((share) => {
              const request = requests.find(
                (r) => r.participantId === share.person.userId,
              );

              return (
                <div key={share.person.userId}>
                  <div className="flex items-start justify-between gap-3">
                    <Person person={share.person} />
                    <span className="shrink-0 text-xs tabular-nums">
                      {displayAmount(share.units)} XLM
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 pl-13 text-[11px] text-muted-foreground">
                    <span>
                      {request
                        ? requestLabels[request.state]
                        : "Organizer’s share · not requested"}
                    </span>
                    {isOrganizer &&
                      request &&
                      (request.state === "outstanding" ||
                        request.state === "declined") && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError(undefined);

                            try {
                              await action({
                                id: request._id,
                                action: "cancel",
                              });
                            } catch (cause) {
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Couldn’t cancel.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Cancel request
                        </Button>
                      )}
                  </div>
                  {request?.hash && (
                    <a
                      className="mt-1 block pl-13 text-[10px] underline"
                      href={`https://stellar.expert/explorer/testnet/tx/${request.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Confirmed transaction ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
            {(
              [
                "paid",
                "outstanding",
                "submitting",
                "declined",
                "cancelled",
              ] as const
            ).map((state) => (
              <p key={state}>
                {requestLabels[state]}
                <span className="mt-1 block tabular-nums text-muted-foreground">
                  {displayAmount(
                    requests
                      .filter((r) => r.state === state)
                      .reduce((sum, r) => sum + BigInt(r.units), BigInt(0))
                      .toString(),
                  )}{" "}
                  XLM
                </span>
              </p>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
            Delivery does not mean someone read, accepted, or paid this request.
            Sent shares stay fixed.
          </p>
        </>
      )}
    </article>
  );
}
