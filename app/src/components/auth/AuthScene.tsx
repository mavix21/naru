"use client";

import type { ReactNode } from "react";

import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { Frame, Scene } from "@/components/onboarding/Frame";
import { useCompanionDraft } from "@/lib/companion";

export function AuthScene({ children }: { children: ReactNode }) {
  const draft = useCompanionDraft();

  return (
    <Frame back="/create">
      <Scene>
        <CompanionScene name={draft.name} accent={draft.accent} />
        <div className="flex w-full min-w-0 justify-center max-md:pt-3">
          {children}
        </div>
      </Scene>
    </Frame>
  );
}
