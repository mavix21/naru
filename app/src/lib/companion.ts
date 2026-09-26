"use client";

import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

export { accents, type Accent, type CompanionSettings } from "./companion-art";

const draftSchema = z.object({
  name: z.string().max(32),
  accent: z.enum(["sky", "coral", "sunshine"]),
  saveRequested: z.boolean(),
});

export type CompanionDraft = z.infer<typeof draftSchema>;

const initial: CompanionDraft = {
  name: "Naru",
  accent: "sky",
  saveRequested: false,
};

const draftKey = "naru:companion-draft:v1";

const draftEvent = "naru:draft-changed";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(draftEvent, listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(draftEvent, listener);
  };
}

function snapshot() {
  try {
    return localStorage.getItem(draftKey);
  } catch {
    return null;
  }
}

export function useCompanionDraft() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);

  return useMemo(() => {
    if (!raw) return initial;

    try {
      const result = draftSchema.safeParse(JSON.parse(raw));

      return result.success ? result.data : initial;
    } catch {
      return initial;
    }
  }, [raw]);
}

export function saveDraft(draft: CompanionDraft) {
  localStorage.setItem(draftKey, JSON.stringify(draftSchema.parse(draft)));
  window.dispatchEvent(new Event(draftEvent));
}

export function clearDraft() {
  try {
    localStorage.removeItem(draftKey);
    window.dispatchEvent(new Event(draftEvent));
  } catch {
    // The server's existing companion always wins, even if local cleanup fails.
  }
}

export function validName(name: string) {
  return (
    name.trim().length > 0 &&
    name.trim().length <= 32 &&
    !/[\p{Cc}\p{Cf}]/u.test(name)
  );
}

export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
