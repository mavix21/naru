"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useQuery } from "convex/react";

export function SplitRequestMessage({ id }: { id: Id<"paymentRequests"> }) {
  const card = useQuery(api.directMessages.requestCard, { id });

  if (!card)
    return (
      <output className="text-xs text-muted-foreground">
        Loading request…
      </output>
    );

  return (
    <article
      aria-label={`${card.description} reimbursement request`}
      className="w-64 max-w-full space-y-3 py-1"
    >
      <p className="text-[10px] font-medium text-muted-foreground">
        Organizer-authorized request · Testnet
      </p>
      <h3 className="text-sm font-medium break-words">{card.description}</h3>
      <p className="text-2xl tracking-tight tabular-nums">
        {card.amount} <span className="text-sm">USDC</span>
      </p>
      <p className="text-xs">
        Organizer: {card.organizer.displayName} · @{card.organizer.username}
      </p>
      <output className="block text-xs font-medium">
        {card.state === "paid"
          ? "Paid · confirmed"
          : card.state === "cancelled"
            ? "Cancelled"
            : "Outstanding"}
      </output>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Delivered by {card.organizer.companionName}, their Naru, with the
        organizer’s passkey authorization. This request does not authorize a
        charge.
      </p>
      <a
        className="inline-block text-[11px] underline"
        href={`https://stellar.expert/explorer/testnet/tx/${card.creationHash}`}
        target="_blank"
        rel="noreferrer"
      >
        Published on-chain ↗
      </a>
    </article>
  );
}
