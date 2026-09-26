"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

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

  const draft = useSyncExternalStore(subscribe, snapshot, () => "");

  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const updateDraft = useCallback(
    (value: string) => {
      setFallback(value);

      try {
        localStorage.setItem(key, value);
      } catch {
        /* Editing remains available if browser storage is blocked. */
      }

      window.dispatchEvent(new Event("naru:message-draft"));
    },
    [key],
  );

  return { draft, updateDraft, hydrated };
}
