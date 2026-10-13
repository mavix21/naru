"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { socialCardClass } from "@/components/social/SplitCard";
import { Button } from "@/components/ui/button";
import { profilePath } from "@/lib/profile";

import { GoalFields, goalError, type GoalTerms } from "./GoalFields";

// Naru drafts; only this card's explicit Publish makes the goal public.
export function GoalDraftCard({ id }: { id: Id<"supportGoals"> }) {
  const data = useQuery(api.goals.draft, { id });
  const publish = useMutation(api.goals.publishDraft);
  const discard = useMutation(api.goals.discardDraft);
  const [edits, setEdits] = useState<GoalTerms>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!data)
    return (
      <output className="text-xs text-muted-foreground">
        Loading goal draft…
      </output>
    );

  const { goal, active, username } = data;

  const terms = edits ?? {
    title: goal.title,
    description: goal.description,
    target: goal.target,
  };

  async function run<T>(action: () => Promise<T>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      await action();
    } catch (cause) {
      setError(goalError(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={socialCardClass} aria-label="Support goal draft">
      <p className="mb-4 text-[10px] tracking-wider text-muted-foreground uppercase">
        {goal.state === "draft"
          ? "Goal draft · not published"
          : goal.state === "discarded"
            ? "Goal draft discarded"
            : goal.state === "active"
              ? "Goal published"
              : "Goal published · since ended"}
      </p>
      {goal.state === "draft" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                publish({
                  id,
                  replaceId: active?._id,
                  ...terms,
                }),
              "Couldn’t publish this goal. Please retry.",
            );
          }}
        >
          <GoalFields value={terms} onChange={setEdits} disabled={busy} />
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Tips still go straight to your account and the goal doesn’t restrict
            how you use them. Only confirmed tips sent after publishing count
            toward it.
            {active && (
              <>
                {" "}
                Publishing ends your current goal, “{active.title}”; its history
                and in-progress tips are kept.
              </>
            )}
          </p>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {active ? "Replace & publish" : "Publish goal"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => discard({ id }), "Couldn’t discard this draft.")
              }
            >
              Discard
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm font-medium wrap-anywhere">{goal.title}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            Target {goal.target} USDC
          </p>
          {goal.state === "active" && (
            <Link
              href={profilePath(username)}
              className="mt-3 inline-block text-xs underline underline-offset-4"
            >
              View on your page ↗
            </Link>
          )}
        </>
      )}
    </article>
  );
}
