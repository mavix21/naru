import type { ReactNode } from "react";

import { Frame, Scene } from "@/components/onboarding/Frame";

import { DraftCompanion } from "./DraftCompanion";

export function AuthScene({ children }: { children: ReactNode }) {
  return (
    <Frame back="/create">
      <Scene>
        <DraftCompanion />
        <div className="flex w-full min-w-0 justify-center max-md:pt-3">
          {children}
        </div>
      </Scene>
    </Frame>
  );
}

export function AuthFormLoading() {
  return (
    <div className="flex min-h-110 w-full max-w-100 flex-col items-center gap-6 rounded-2xl border bg-card px-8 py-10 shadow-sm">
      <h1 className="text-lg font-semibold">Your Naru account</h1>
      <output className="sr-only">Loading sign-in options…</output>
      <div
        aria-hidden="true"
        className="w-full space-y-6 motion-safe:animate-pulse"
      >
        <div className="h-10 rounded-lg bg-muted" />
        <div className="mx-auto h-3 w-12 rounded bg-muted" />
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-10 rounded-lg bg-muted" />
        </div>
        <div className="h-10 rounded-lg bg-muted" />
        <div className="mx-auto h-3 w-40 rounded bg-muted" />
      </div>
    </div>
  );
}
