"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { z } from "zod";

const savedDraft = z.object({
  text: z.string().max(4000),
  pending: z
    .object({
      clientId: z.string().regex(/^[\w-]{1,100}$/),
      text: z.string().min(1).max(4000),
    })
    .optional(),
});

type Draft = z.infer<typeof savedDraft>;

function parse(raw: string): Draft {
  try {
    return savedDraft.safeParse(JSON.parse(raw)).data ?? { text: "" };
  } catch {
    return { text: "" };
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("naru:direct-draft", listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("naru:direct-draft", listener);
  };
}

export function useDirectDraft(userId: string, conversationId: string) {
  const key = `naru:dm:v1:${userId}:${conversationId}`;
  const [fallback, setFallback] = useState("");

  const snapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const draft = useMemo(() => parse(raw), [raw]);

  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const readDraft = useCallback(() => parse(snapshot()), [snapshot]);

  const updateDraft = useCallback(
    (update: (current: Draft) => Draft) => {
      const stored = JSON.stringify(update(parse(snapshot())));
      setFallback(stored);

      try {
        window.localStorage.setItem(key, stored);
      } catch {
        /* Keep sending available when browser storage is blocked. */
      }

      window.dispatchEvent(new Event("naru:direct-draft"));
    },
    [key, snapshot],
  );

  return { draft, hydrated, updateDraft, readDraft };
}
