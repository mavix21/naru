"use client";

import type { Doc, Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { NARU_SPLIT } from "@naru/backend/money";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { displayAmount, equalShares, parseAmount } from "@/lib/money";

import { PersonAvatar } from "./Person";
import { PublishSplit } from "./PublishSplit";
import { SplitResult } from "./SplitResult";

export const requestLabels = {
  outstanding: "Outstanding",
  submitting: "Transaction pending",
  paid: "Paid · confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
} as const;

export const socialCardClass =
  "my-5 w-full min-w-0 overflow-hidden rounded-3xl border border-border/80 bg-card p-5 shadow-xs md:p-6";

const splitCardClass =
  "my-4 w-full min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-xs";

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
  const controlId = useId();
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
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string>();

  const dirty =
    (split.asset === "USDC" &&
      split.creation?.contract !== NARU_SPLIT.contract) ||
    title !== split.title ||
    total !== split.total ||
    includeSelf !== split.includeSelf ||
    mode !== split.mode ||
    ids.join() !== split.participantIds.join();

  let calculation: ReturnType<typeof equalShares> = [];
  let invalid: string | undefined;

  const staleShares =
    split.asset === "USDC" &&
    (total !== split.total ||
      includeSelf !== split.includeSelf ||
      ids.join() !== split.participantIds.join());

  try {
    parseAmount(total, split.asset);
    calculation =
      split.asset === "USDC"
        ? split.shares.map((s) => ({ userId: s.person.userId, units: s.units }))
        : equalShares(total, [
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

  const ownShare = calculation.find(
    (share) => share.userId === split.organizer.userId,
  );

  const availableFriends = social?.friends.filter(
    ({ person }) => !ids.includes(person.userId),
  );

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
    <fieldset disabled={busy || authorizing} className="space-y-3">
      {split.asset === "USDC" &&
        split.creation?.contract !== NARU_SPLIT.contract && (
          <p className="text-xs text-muted-foreground">
            Contract updated. Save to refresh this review.
          </p>
        )}
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <label className="min-w-0 text-xs text-muted-foreground">
          Expense
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            className="mt-1.5 block w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-ring"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Total · {split.asset}
          <input
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            inputMode="decimal"
            maxLength={40}
            className="mt-1.5 block w-full rounded-xl border bg-background px-3 py-2 text-sm font-medium text-foreground tabular-nums outline-ring"
          />
        </label>
      </div>
      {split.asset === "USDC" ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Reimbursement</span>
          <Badge variant="secondary">
            <IconCheck aria-hidden="true" /> Already paid
          </Badge>
        </div>
      ) : (
        <fieldset>
          <legend id={`${controlId}-expense`} className="sr-only">
            When is this expense paid?
          </legend>
          <RadioGroup
            name={`${controlId}-mode`}
            value={mode}
            disabled={busy || authorizing}
            aria-labelledby={`${controlId}-expense`}
            onValueChange={(value) => {
              if (value === "collect" || value === "reimburse") setMode(value);
            }}
            className="grid-cols-2"
          >
            {[
              { value: "collect", label: "Before paying" },
              { value: "reimburse", label: "Already paid" },
            ].map((option) => (
              <label
                key={option.value}
                htmlFor={`${controlId}-${option.value}`}
                className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs has-data-checked:border-primary/40 has-data-checked:bg-primary/5"
              >
                <RadioGroupItem
                  id={`${controlId}-${option.value}`}
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      )}
      <fieldset className="space-y-1">
        <legend className="mb-2 flex w-full items-center justify-between text-xs">
          <span>Equal shares</span>
          <span className="text-muted-foreground">
            {ids.length + (includeSelf ? 1 : 0)} people
          </span>
        </legend>
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-muted/30 px-2.5 py-2">
          {split.asset === "XLM" ? (
            <input
              id={`${controlId}-self`}
              type="checkbox"
              aria-label="Include my share"
              checked={includeSelf}
              onChange={(e) => setIncludeSelf(e.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
          ) : (
            <IconCheck
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          )}
          <PersonAvatar person={split.organizer} className="size-7" />
          {split.asset === "XLM" ? (
            <label htmlFor={`${controlId}-self`} className="flex-1 text-sm">
              You
            </label>
          ) : (
            <span className="flex-1 text-sm">You</span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {staleShares || invalid
              ? "—"
              : ownShare
                ? `${displayAmount(ownShare.units)} ${split.asset}`
                : "Excluded"}
          </span>
        </div>
        {ids.map((id) => {
          const person = identities.find((identity) => identity.userId === id);
          const share = calculation.find((entry) => entry.userId === id);

          const noLongerFriends =
            social &&
            !social.friends.some((friend) => friend.person.userId === id);

          return (
            <label
              key={id}
              className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-muted/30"
            >
              <input
                type="checkbox"
                checked
                onChange={() =>
                  setIds(ids.filter((selected) => selected !== id))
                }
                className="size-4 shrink-0 accent-primary"
              />
              {person && <PersonAvatar person={person} className="size-7" />}
              <span className="min-w-0 flex-1 truncate text-sm">
                {person?.displayName ?? "Friend"}
                {person && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    @{person.username}
                  </span>
                )}
              </span>
              {noLongerFriends ? (
                <Badge variant="destructive">Not friends</Badge>
              ) : (
                <span className="shrink-0 text-xs tabular-nums">
                  {staleShares || invalid || !share
                    ? "—"
                    : `${displayAmount(share.units)} ${split.asset}`}
                </span>
              )}
            </label>
          );
        })}
        {!!availableFriends?.length && (
          <details className="pt-1">
            <summary className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <span className="inline-flex items-center gap-1">
                <IconPlus className="size-3.5" aria-hidden="true" /> Add friends
              </span>
            </summary>
            <div className="max-h-48 overflow-y-auto">
              {availableFriends.map(({ person }) => (
                <label
                  key={person.userId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-muted/30"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={ids.length >= 12}
                    onChange={() => setIds([...ids, person.userId])}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <PersonAvatar person={person} className="size-7" />
                  <span className="min-w-0 truncate text-sm">
                    {person.displayName}
                    <span className="ml-1 text-xs text-muted-foreground">
                      @{person.username}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {ids.length >= 12 && (
              <p className="px-2.5 text-xs text-muted-foreground">
                12-friend limit
              </p>
            )}
          </details>
        )}
      </fieldset>
      <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs">
        <span className="text-muted-foreground">
          Requests · {ids.length} {ids.length === 1 ? "friend" : "friends"}
        </span>
        <span className="font-medium tabular-nums">
          {staleShares || invalid
            ? "—"
            : `${displayAmount(requested.toString())} ${split.asset}`}
        </span>
      </div>
      {staleShares && (
        <p className="text-xs text-muted-foreground">Save to update shares.</p>
      )}
      {(error || invalid) && (
        <p role="alert" className="text-xs text-destructive">
          {error || invalid}
        </p>
      )}
      {split.asset === "USDC" && !dirty ? (
        <PublishSplit split={split} onBusyChange={setAuthorizing} />
      ) : (
        <Button
          className="w-full"
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
              ? "Save changes"
              : `Send ${ids.length} ${ids.length === 1 ? "request" : "requests"}`}
        </Button>
      )}
      {(payment && payment.state !== "ready") || payment === null ? (
        <ActivationReturn kind="split" id={split._id} />
      ) : null}
    </fieldset>
  );
}

export function SplitCard({ id }: { id: Id<"splits"> }) {
  const data = useQuery(api.splits.get, { id });

  if (!data)
    return (
      <div className={splitCardClass}>
        <output className="text-xs text-muted-foreground">
          Loading split…
        </output>
      </div>
    );
  const { split, requests, isOrganizer } = data;

  if (split.state !== "draft")
    return (
      <SplitResult
        split={split}
        requests={requests}
        isOrganizer={isOrganizer}
      />
    );

  return (
    <article className={splitCardClass} aria-label={`${split.title} split`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Badge variant="secondary">
          {split.state === "draft" ? "Review split" : "Shared expense"}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Testnet · {split.asset}
        </span>
      </div>
      <SplitDraft key={split.revision} split={split} />
    </article>
  );
}
