"use client";

import { UserButton } from "@clerk/nextjs";

import { useHydrated } from "@/lib/companion";

export function SessionMenu() {
  const hydrated = useHydrated();

  // Clerk's imperative widget can initialize ahead of a streamed header's hydration.
  return hydrated ? (
    <UserButton />
  ) : (
    <span
      aria-hidden="true"
      className="size-7 shrink-0 rounded-full bg-muted"
    />
  );
}
