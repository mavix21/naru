"use client";

import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { profilePath } from "@/lib/profile";

export function ProfileSettings() {
  const profile = useQuery(api.profiles.current);

  if (!profile?.displayName)
    return (
      <p className="text-xs text-muted-foreground">Your profile is syncing…</p>
    );

  return <ProfileEditor key={profile._id} profile={profile} />;
}

function ProfileEditor({ profile }: { profile: Doc<"profiles"> }) {
  const update = useMutation(api.profiles.updatePublic);
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();

        if (busy) return;
        setBusy(true);
        setSaved(false);
        setError(undefined);

        try {
          await update({ displayName, bio });
          setSaved(true);
          router.refresh();
        } catch (cause) {
          const message =
            cause instanceof ConvexError
              ? z.string().safeParse(cause.data).data
              : undefined;

          setError(message || "Couldn’t save your profile. Please retry.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="text-sm font-medium">Your public profile</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Your name, bio and Naru are public at your username link. Your chats
          and money stay private.
        </p>
      </div>
      {profile.username ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium">@{profile.username}</span>
          <Link
            href={profilePath(profile.username)}
            className="underline underline-offset-4"
          >
            View public profile ↗
          </Link>
        </div>
      ) : (
        <Link
          href="/username"
          className="block text-xs font-medium underline underline-offset-4"
        >
          Choose your username ↗
        </Link>
      )}
      <label className="block text-xs">
        Your display name
        <input
          required
          maxLength={60}
          autoComplete="name"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          className="mt-2 w-full rounded-xl border bg-background px-3 py-2 text-base outline-ring"
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Your human name. Your companion keeps its own name.
        </span>
      </label>
      <label className="block text-xs">
        Short bio <span className="text-muted-foreground">(optional)</span>
        <input
          maxLength={160}
          value={bio}
          onChange={(event) => {
            setBio(event.target.value);
            setSaved(false);
          }}
          placeholder="A little about you"
          className="mt-2 w-full rounded-xl border bg-background px-3 py-2 text-base outline-ring"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        <output className="text-xs text-muted-foreground">
          {saved ? "Profile saved." : ""}
        </output>
      </div>
    </form>
  );
}
