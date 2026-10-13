"use client";

import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { GoalFields, goalError, type GoalTerms } from "./GoalFields";
import { GoalProgress } from "./GoalProgress";

type Goals = NonNullable<FunctionReturnType<typeof api.goals.mine>>;

type Goal = NonNullable<Goals["active"]>;

const empty: GoalTerms = { title: "", description: "", target: "" };

export function GoalSettings() {
  const goals = useQuery(api.goals.mine);

  return (
    <section aria-labelledby="goal-settings-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="goal-settings-heading" className="text-base font-medium">
          Support goal
        </h3>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Show one goal on your public page. Tips still arrive directly in your
        account as they do today, and the goal doesn’t restrict how you use
        them.
      </p>
      <div className="mt-5">
        {goals === undefined ? (
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-10 w-32" />
          </div>
        ) : goals === null ? (
          <Link
            href="/username"
            className="flex min-h-11 items-center rounded-2xl bg-muted/50 px-4 py-3 text-sm font-medium underline underline-offset-4"
          >
            Choose your username to add a goal ↗
          </Link>
        ) : (
          <GoalEditor key={goals.active?._id ?? "new"} goals={goals} />
        )}
      </div>
    </section>
  );
}

function GoalEditor({ goals }: { goals: Goals }) {
  const { active, past } = goals;
  const create = useMutation(api.goals.create);
  const update = useMutation(api.goals.update);
  const archive = useMutation(api.goals.archive);
  const [mode, setMode] = useState<"view" | "edit" | "end">("view");
  const [draft, setDraft] = useState<GoalTerms>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const terms =
    draft ??
    (active
      ? {
          title: active.title,
          description: active.description,
          target: active.target,
        }
      : empty);

  async function run<T>(action: () => Promise<T>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      await action();
      setDraft(undefined);
      setMode("view");
    } catch (cause) {
      setError(goalError(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => (active ? update({ id: active._id, ...terms }) : create(terms)),
          "Couldn’t save your goal. Please retry.",
        );
      }}
    >
      <GoalFields
        value={terms}
        onChange={setDraft}
        disabled={busy}
        locked={active?.locked}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Saving…" : active ? "Save changes" : "Publish goal"}
        </Button>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={busy}
            onClick={() => {
              setDraft(undefined);
              setError(undefined);
              setMode("view");
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      {!active ? (
        form
      ) : mode === "edit" ? (
        form
      ) : (
        <ActiveGoal goal={active}>
          {mode === "end" ? (
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-medium">End this goal?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                It leaves your public page and stays in your history below. Tips
                already in progress still count toward it. You can start a new
                goal afterwards.
              </p>
              {error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => archive({ id: active._id }),
                      "Couldn’t end your goal. Please retry.",
                    )
                  }
                >
                  {busy ? "Ending…" : "End goal"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setMode("view")}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("edit")}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode("end")}
              >
                End goal
              </Button>
            </div>
          )}
        </ActiveGoal>
      )}
      {past.length > 0 && (
        <div className="border-t pt-5">
          <h4 className="text-xs font-medium text-muted-foreground">
            Past goals
          </h4>
          <ul className="mt-2 divide-y text-sm">
            {past.map((goal) => (
              <li
                key={goal._id}
                className="flex items-baseline justify-between gap-4 py-2.5"
              >
                <span className="min-w-0 truncate" title={goal.title}>
                  {goal.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {goal.raised} of {goal.target} USDC
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActiveGoal({
  goal,
  children,
}: {
  goal: Goal;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-muted/50 p-4">
        <p className="text-sm font-medium wrap-anywhere">{goal.title}</p>
        {goal.description && (
          <p className="mt-1 text-xs leading-5 wrap-anywhere text-muted-foreground">
            {goal.description}
          </p>
        )}
        <GoalProgress goal={goal} className="mt-3" />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {goal.contributions === 1
            ? "1 confirmed contribution"
            : `${goal.contributions} confirmed contributions`}{" "}
          · visible only to you
        </p>
      </div>
      {children}
    </div>
  );
}
