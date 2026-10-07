"use client";

import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { useCompanionDraft } from "@/lib/companion";

export function DraftCompanion() {
  const draft = useCompanionDraft();

  return <CompanionScene name={draft.name} accent={draft.accent} />;
}
