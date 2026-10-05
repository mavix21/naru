import type { Doc } from "@naru/backend/data-model";

import {
  IconCheck,
  IconClock,
  IconLoader2,
  IconMinus,
  IconX,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

const statuses = {
  outstanding: {
    label: "Requested",
    Icon: IconClock,
    tone: "bg-primary/8 text-primary",
  },
  submitting: {
    label: "Confirming",
    Icon: IconLoader2,
    tone: "bg-primary/8 text-primary",
  },
  paid: { label: "Paid", Icon: IconCheck, tone: "bg-success/10 text-success" },
  declined: {
    label: "Declined",
    Icon: IconX,
    tone: "bg-muted text-muted-foreground",
  },
  cancelled: {
    label: "Cancelled",
    Icon: IconMinus,
    tone: "bg-muted text-muted-foreground",
  },
} as const;

export function RequestStatus({
  state,
}: {
  state: Doc<"paymentRequests">["state"];
}) {
  const { label, Icon, tone } = statuses[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon
        className={cn(
          "size-3",
          state === "submitting" && "motion-safe:animate-spin",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
