"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { editMentions, messageDraft, type Mention } from "@/lib/mentions";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("naru:message-draft", listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("naru:message-draft", listener);
  };
}

export function useMessageDraft(userId: string) {
  const key = `naru:conversation-draft:${userId}`;
  const [fallback, setFallback] = useState("");

  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const raw = useSyncExternalStore(subscribe, snapshot, () => "");

  const { draft, mentions } = useMemo<{
    draft: string;
    mentions: Mention[];
  }>(() => {
    try {
      const value: unknown = JSON.parse(raw);
      const parsed = messageDraft.safeParse(value);

      if (parsed.success)
        return { draft: parsed.data.text, mentions: parsed.data.mentions };
    } catch {
      /* Previous drafts were plain text. */
    }

    return { draft: raw, mentions: [] };
  }, [raw]);

  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const updateDraft = useCallback(
    (value: string, selected?: Mention[]) => {
      const stored = JSON.stringify({
        text: value,
        mentions: selected ?? editMentions(draft, value, mentions),
      });

      setFallback(stored);

      try {
        localStorage.setItem(key, stored);
      } catch {
        /* Editing remains available if browser storage is blocked. */
      }

      window.dispatchEvent(new Event("naru:message-draft"));
    },
    [key, draft, mentions],
  );

  return { draft, mentions, updateDraft, hydrated };
}
