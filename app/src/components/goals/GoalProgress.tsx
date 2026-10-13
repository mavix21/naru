import { cn } from "@/lib/utils";

export type GoalAmounts = {
  raised: string;
  target: string;
  percent: number;
};

// Integer percent from the server; the bar caps at full while the text keeps
// reporting honest totals past the target.
export function GoalProgress({
  goal,
  swatch,
  className,
}: {
  goal: GoalAmounts;
  swatch?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        <span className="text-2xl font-medium tracking-tight">
          {goal.raised}
        </span>
        <span className="text-xs text-muted-foreground">
          USDC raised of {goal.target}
        </span>
      </p>
      <progress
        className="sr-only"
        aria-label="Goal progress"
        max={100}
        value={Math.min(goal.percent, 100)}
        aria-valuetext={`${goal.raised} of ${goal.target} USDC, ${goal.percent}%`}
      />
      <div
        aria-hidden="true"
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
            swatch ?? "bg-primary",
          )}
          style={{ width: `${Math.min(goal.percent, 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
        {goal.percent}%{goal.percent >= 100 ? " · target reached" : ""}
      </p>
    </div>
  );
}
