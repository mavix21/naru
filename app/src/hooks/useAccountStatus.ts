"use client";

import { useQuery } from "@tanstack/react-query";

import { conversationRequest } from "@/lib/conversation/client";
import { fundedPaymentSchema } from "@/lib/smart-account/payments";
import { fundingInProgress, type Job } from "@/lib/smart-account/shared";

export function useAccountStatus(userId: string, funding?: Job) {
  return useQuery({
    queryKey: funding
      ? ["conversation-account", userId, funding.id]
      : ["conversation-account", userId],
    queryFn: async () =>
      fundedPaymentSchema.parse(
        await conversationRequest(
          userId,
          funding
            ? `/api/payments?fundingId=${encodeURIComponent(funding.id)}`
            : "/api/payments",
        ),
      ),
    enabled: !funding || fundingInProgress(funding),
    refetchOnWindowFocus: true,
    refetchInterval: (current) =>
      fundingInProgress(current.state.data?.funding ?? funding) ||
      current.state.data?.state === "pending"
        ? 4000
        : false,
  });
}
