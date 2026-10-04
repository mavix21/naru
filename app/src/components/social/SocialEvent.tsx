import type { Doc } from "@naru/backend/data-model";

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

  if (event.replyId) return <ReplyCard id={event.replyId} />;

  if (event.requestId)
    return <RequestCard id={event.requestId} userId={userId} event={event} />;

  if (event.splitId) return <SplitCard id={event.splitId} />;

  return null;
}
