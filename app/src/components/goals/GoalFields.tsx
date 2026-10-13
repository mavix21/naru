"use client";

import { ConvexError } from "convex/values";
import { useId } from "react";
import { z } from "zod";

export type GoalTerms = { title: string; description: string; target: string };

const field =
  "mt-2 block min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base font-normal outline-ring disabled:opacity-60 md:text-sm";

export function goalError(cause: unknown, fallback: string) {
  return (
    (cause instanceof ConvexError
      ? z.string().safeParse(cause.data).data
      : undefined) || fallback
  );
}

export function GoalFields({
  value,
  onChange,
  disabled,
  locked,
}: {
  value: GoalTerms;
  onChange: (next: GoalTerms) => void;
  disabled?: boolean;
  locked?: boolean;
}) {
  const lockNote = useId();

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">
        Title
        <input
          required
          maxLength={60}
          value={value.title}
          disabled={disabled || locked}
          aria-describedby={locked ? lockNote : undefined}
          onChange={(event) =>
            onChange({ ...value, title: event.target.value })
          }
          placeholder="New drawing tablet"
          className={field}
        />
      </label>
      <label className="block text-sm font-medium">
        Short description{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
        <input
          maxLength={200}
          value={value.description}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
          placeholder="What it’s for, in a sentence"
          className={field}
        />
      </label>
      <label className="block text-sm font-medium">
        Target
        <span className="relative block">
          <input
            required
            inputMode="decimal"
            autoComplete="off"
            maxLength={40}
            value={value.target}
            disabled={disabled || locked}
            aria-describedby={locked ? lockNote : undefined}
            onChange={(event) =>
              onChange({ ...value, target: event.target.value.trim() })
            }
            placeholder="250"
            className={`${field} pr-16 tabular-nums`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-normal text-muted-foreground">
            USDC
          </span>
        </span>
      </label>
      {locked && (
        <p id={lockNote} className="text-xs leading-5 text-muted-foreground">
          This goal has confirmed contributions, so its title and target are
          locked. End it and start a new goal to change them.
        </p>
      )}
    </div>
  );
}
