import { cn } from "@/lib/utils";

import { GoalProgress, type GoalAmounts } from "./GoalProgress";

export function SupportGoal({
  goal,
  displayName,
  swatch,
}: {
  goal: GoalAmounts & { title: string; description: string };
  displayName: string;
  swatch: string;
}) {
  return (
    <section
      aria-labelledby="goal-heading"
      className="rounded-3xl border bg-card p-5 md:p-6"
    >
      <p className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", swatch)}
        />
        Support goal
      </p>
      <h2
        id="goal-heading"
        className="mt-2 text-base font-medium wrap-anywhere"
      >
        {goal.title}
      </h2>
      {goal.description && (
        <p className="mt-1 text-xs leading-5 wrap-anywhere text-muted-foreground">
          {goal.description}
        </p>
      )}
      <GoalProgress goal={goal} swatch={swatch} className="mt-4" />
      <p className="mt-3 border-t pt-3 text-[11px] leading-5 text-muted-foreground">
        Tips go straight to {displayName}’s Naru account, and the goal doesn’t
        restrict how they’re used. Only confirmed Testnet USDC tips (test funds)
        sent while this goal is live are counted.
      </p>
    </section>
  );
}
