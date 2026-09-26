"use client";

import { api } from "@naru/backend/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQuery as useConvexQuery } from "convex/react";
import { useState } from "react";
import { z } from "zod";

import { paymentStateSchema } from "@/lib/smart-account/payments";

const errorSchema = z.object({ error: z.string() });

async function paymentRequest(userId: string, body?: string) {
  const headers = new Headers({ "X-Naru-User": userId });

  if (body) headers.set("Content-Type", "application/json");

  const response = await fetch("/api/payments", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    throw new Error(
      error.success
        ? error.data.error
        : "Payment status is unavailable. Please retry.",
    );
  }

  return paymentStateSchema.parse(data);
}

function friendlyError(cause: unknown) {
  const message =
    cause instanceof Error
      ? cause.message
      : "Activation could not finish. Please retry.";

  return /cancel|not allowed|timed out|denied|NotAllowedError/i.test(message)
    ? "Passkey not confirmed. You can retry when you’re ready."
    : message;
}

export function usePayments(userId: string) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const queryKey = ["payments", userId];

  // The persisted Convex record keeps the last verified state available even
  // when the live status request is slow or unavailable.
  const stored = useConvexQuery(api.payments.current);

  const query = useQuery({
    queryKey,
    queryFn: () => paymentRequest(userId),
    refetchOnWindowFocus: true,
    refetchInterval: (current) =>
      current.state.data?.job?.state === "pending" ||
      current.state.data?.job?.state === "preparing"
        ? 4_000
        : false,
  });

  const activate = useMutation({
    mutationFn: async () => {
      setError(undefined);

      // Linked attempts can resume from any device without a new credential.
      if (query.data?.account) {
        await paymentRequest(userId, JSON.stringify({ action: "resume" }));

        return;
      }

      if (!navigator.locks)
        throw new Error(
          "Use a current browser that supports passkeys and secure storage.",
        );
      await navigator.locks.request(
        `naru:payments:${userId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Activation is open in another tab. Continue there.",
            );
          const deviceKey = `naru:payment-device:${userId}`;
          let device = localStorage.getItem(deviceKey);

          if (!device) {
            device = crypto.randomUUID();
            localStorage.setItem(deviceKey, device);
          }

          const { NaruSmartAccount } =
            await import("@/lib/smart-account/adapter");

          const account = await NaruSmartAccount.open("/api/payments", userId);

          await account.activate(device, () => setConfirming(true));
        },
      );
    },
    onError: (cause) => setError(friendlyError(cause)),
    onSettled: async () => {
      setConfirming(false);
      // An interrupted HTTP response is not a failed deployment. Reconcile the
      // persisted attempt before offering any retry.
      await client.invalidateQueries({ queryKey });
    },
  });

  return {
    payment: query.data ?? stored ?? null,
    loading: query.isPending && !stored,
    query,
    error,
    confirming,
    activate,
  };
}
