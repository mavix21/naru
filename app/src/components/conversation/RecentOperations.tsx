"use client";

import { api } from "@naru/backend/api";
import { usePreloadedQuery, type Preloaded } from "convex/react";

import { TransferCard, operationLabels } from "./TransferCard";

export function RecentOperations({
  preloaded,
  userId,
}: {
  preloaded: Preloaded<typeof api.operations.recent>;
  userId: string;
}) {
  const operations = usePreloadedQuery(preloaded);

  return (
    <div>
      <h2 className="mb-5 text-sm font-medium">Recent operations</h2>
      {!operations.length && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          A little room for what’s next. Transfers you prepare will appear here.
        </p>
      )}
      <div className="divide-y">
        {operations.map((operation) => (
          <details key={operation._id} className="py-3 first:pt-0">
            <summary className="cursor-pointer list-none rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
              <span className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  ↗ {operation.recipientName}
                </span>
                <span className="shrink-0 tabular-nums">
                  {operation.amount} XLM
                </span>
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {operationLabels[operation.state]}
              </span>
            </summary>
            <TransferCard operation={operation} userId={userId} />
          </details>
        ))}
      </div>
    </div>
  );
}
