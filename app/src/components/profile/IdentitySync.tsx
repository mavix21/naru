"use client";

import { api } from "@naru/backend/api";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { syncProfile } from "@/app/username/actions";

export function IdentitySync() {
  const { isAuthenticated } = useConvexAuth();
  const profile = useQuery(api.profiles.current, isAuthenticated ? {} : "skip");

  if (!isAuthenticated || profile === undefined) return null;

  // A completed claim resets any previous conflict notice and verifies its
  // mirror once more. Missing usernames never gate the surrounding app.
  return (
    <IdentityStatus
      key={profile?.username ?? "missing"}
      username={profile?.username}
    />
  );
}

function IdentityStatus({ username }: { username?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startTransition(async () => {
      try {
        const result = await syncProfile();

        if (!active) return;
        setError(result.error);

        if (result.username) router.refresh();

        if (result.error && result.retryable && attempt < 3)
          timer = setTimeout(
            () => setAttempt((value) => value + 1),
            2000 * 2 ** attempt,
          );
      } catch {
        if (active)
          setError("Your profile couldn’t sync. Retry when you’re connected.");
      }
    });

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt, router]);

  if (username && !error) return null;

  return (
    <aside
      className="shrink-0 border-b border-primary/15 bg-primary/5 px-4 py-3 text-xs"
      aria-label="Your public profile"
    >
      <div className="mx-auto flex max-w-400 flex-wrap items-center justify-between gap-2">
        <p>
          {error ||
            "A little more you. Choose a username for your public Naru link."}
        </p>
        <div className="flex shrink-0 items-center gap-4 font-medium">
          {error && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAttempt((value) => value + 1)}
              className="underline underline-offset-4"
            >
              {busy ? "Syncing…" : "Retry sync"}
            </button>
          )}
          {!username && (
            <Link href="/username" className="underline underline-offset-4">
              Choose username ↗
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
