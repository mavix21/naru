"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { RequestCard } from "./RequestCard";
import { SocialEvent } from "./SocialEvent";
import { SplitCard } from "./SplitCard";

export function FocusedSocialCard({ userId }: { userId: string }) {
  const params = useSearchParams();
  const eventId = params?.get("event");
  const request = params?.get("request");
  const split = params?.get("split");
  // SAFETY: these remain untrusted route IDs; the card's Convex v.id validator
  // and access checks enforce table membership and the authenticated viewer.
  const requestId = request as Id<"paymentRequests"> | null | undefined;
  // SAFETY: the split query checks both the ID table and viewer's membership.
  const splitId = split as Id<"splits"> | null | undefined;

  const event = useQuery(
    api.conversations.event,
    eventId ? { messageId: eventId } : "skip",
  );

  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (event || request || split)
      target.current?.scrollIntoView({ block: "start" });
  }, [event, request, split]);

  if (!eventId && !request && !split) return null;

  return (
    <div ref={target} className="mb-6 border-b pb-4">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>From your conversation</span>
        <Link href="/home" className="underline underline-offset-4">
          Back to conversation
        </Link>
      </div>
      {eventId ? (
        event ? (
          <SocialEvent event={event} userId={userId} />
        ) : (
          <p className="py-4 text-xs">
            {event === undefined
              ? "Finding your card…"
              : "This event isn’t in your conversation."}
          </p>
        )
      ) : requestId && /^[a-z0-9]{20,40}$/.test(requestId) ? (
        <RequestCard id={requestId} userId={userId} />
      ) : splitId && /^[a-z0-9]{20,40}$/.test(splitId) ? (
        <SplitCard id={splitId} />
      ) : null}
    </div>
  );
}
