"use client";

import { useUser } from "@clerk/nextjs";
import { api } from "@naru/backend/api";
import { useMutation } from "convex/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function UsernameForm({
  initial,
  onSaved,
}: {
  initial?: { username: string; displayName: string };
  onSaved?: () => void;
}) {
  const { user } = useUser();
  const [username, setUsername] = useState(initial?.username ?? "");

  const [displayName, setDisplayName] = useState(
    initial?.displayName ?? user?.firstName ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const claim = useMutation(api.social.claimUsername);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();

        if (busy) return;
        setBusy(true);
        setError(undefined);

        try {
          await claim({ username, displayName });
          onSaved?.();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t save your username.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="text-lg tracking-tight">A name for your people.</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Friends find you by your unique username. Your companion keeps its own
          name.
        </p>
      </div>
      <label className="block text-xs">
        Your display name
        <input
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-2 block w-full rounded-xl border bg-background px-3 py-2 text-base outline-ring"
        />
      </label>
      <label className="block text-xs">
        Username
        <input
          required
          minLength={3}
          maxLength={24}
          pattern="[A-Za-z][A-Za-z0-9_]{2,23}"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your_name"
          className="mt-2 block w-full rounded-xl border bg-background px-3 py-2 text-base outline-ring"
        />
        <span className="mt-2 block text-[10px] text-muted-foreground">
          3–24 letters, numbers or underscores. Case-insensitive.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save username"}
      </Button>
    </form>
  );
}
