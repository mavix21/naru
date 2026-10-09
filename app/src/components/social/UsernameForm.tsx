"use client";

import { api } from "@naru/backend/api";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { syncProfile } from "@/app/username/actions";
import { Button } from "@/components/ui/button";

export function UsernameForm({ onSaved }: { onSaved?: () => void }) {
  const profile = useQuery(api.profiles.current);
  const [username, setUsername] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();

        if (busy) return;
        setError(undefined);
        startTransition(async () => {
          try {
            const result = await syncProfile(username);

            if (result.error) {
              setError(result.error);

              return;
            }

            onSaved?.();
            router.refresh();
          } catch {
            setError("Couldn’t save your username. Please retry.");
          }
        });
      }}
    >
      <div>
        <h2 className="text-xl font-medium tracking-tight">
          Your own little corner.
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your username forms a public link:{" "}
          <span className="font-medium">/@username</span>. Anyone can see your
          name, bio and Naru there.
        </p>
      </div>
      <label className="block text-sm">
        Username
        <div className="mt-2 flex items-center gap-1 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <span aria-hidden="true" className="text-muted-foreground">
            @
          </span>
          <input
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z][A-Za-z0-9_]{2,23}"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            value={profile?.username ?? username}
            disabled={busy || !!profile?.username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="your_name"
            aria-describedby="username-help"
            className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
          />
        </div>
        <span
          id="username-help"
          className="mt-2 block text-xs leading-5 text-muted-foreground"
        >
          3–24 letters, numbers or underscores, starting with a letter.
          Case-insensitive. Choose a link you’ll want to keep.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !!profile?.username}>
        {busy
          ? "Saving…"
          : profile?.username
            ? "Username saved"
            : "Save username"}
      </Button>
    </form>
  );
}
