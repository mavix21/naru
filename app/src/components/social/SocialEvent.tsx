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
  if (event.replyId) return <ReplyCard id={event.replyId} />;

  if (event.requestId)
    return <RequestCard id={event.requestId} userId={userId} event={event} />;

  if (event.splitId) return <SplitCard id={event.splitId} />;

  return null;
}
