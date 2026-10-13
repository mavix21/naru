import type { Doc } from "@naru/backend/data-model";

import { GoalDraftCard } from "@/components/goals/GoalDraftCard";

import { ReplyCard } from "./ReplyCard";
import { RequestCard } from "./RequestCard";
import { SplitCard } from "./SplitCard";

export function SocialEvent({
  event,
  userId,
}: {
  event: NonNullable<Doc<"messages">["event"]>;
  userId: string;
}) {
  if (event.kind === "transfer_received" && event.transfer)
    return (
      <article
        aria-label="Received payment"
        className="my-3 rounded-2xl border bg-card p-5 text-sm"
      >
        <p className="text-xs text-muted-foreground">Received · confirmed</p>
        <p className="mt-2 text-2xl tabular-nums">
          {event.transfer.amount} {event.transfer.asset}
        </p>
        <p className="mt-2">
          From {event.actor.displayName}{" "}
          <span className="text-muted-foreground">@{event.actor.username}</span>
        </p>
        <a
          className="mt-3 inline-block text-xs underline underline-offset-4"
          href={`https://stellar.expert/explorer/testnet/tx/${event.transfer.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View confirmed receipt ↗
        </a>
      </article>
    );

  if (event.kind === "tip_received" && event.tip)
    return (
      <article
        aria-label="Received tip"
        className="my-3 rounded-2xl border bg-card p-5 text-sm"
      >
        <p className="text-xs text-muted-foreground">
          Tip from your public profile · confirmed
        </p>
        <p className="mt-2 text-2xl tabular-nums">
          {event.tip.amount} {event.tip.asset}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          From wallet{" "}
          <span className="font-mono text-foreground" title={event.tip.from}>
            {event.tip.from.slice(0, 4)}…{event.tip.from.slice(-4)}
          </span>{" "}
          (not a verified Naru identity)
        </p>
        {event.tip.goal && (
          <p className="mt-1 text-xs text-muted-foreground">
            Counted toward your goal{" "}
            <span className="text-foreground">{event.tip.goal}</span>
          </p>
        )}
        <a
          className="mt-3 inline-block text-xs underline underline-offset-4"
          href={`https://stellar.expert/explorer/testnet/tx/${event.tip.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View confirmed receipt ↗
        </a>
      </article>
    );

  if (event.kind === "goal_draft" && event.goalId)
    return <GoalDraftCard id={event.goalId} />;

  if (event.replyId) return <ReplyCard id={event.replyId} />;

  if (event.requestId)
    return <RequestCard id={event.requestId} userId={userId} event={event} />;

  if (event.splitId) return <SplitCard id={event.splitId} />;

  return null;
}
