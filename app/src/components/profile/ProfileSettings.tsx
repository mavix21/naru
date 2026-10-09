"use client";

import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import {
  useMutation,
  usePreloadedQuery,
  useQuery,
  type Preloaded,
} from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { profilePath } from "@/lib/profile";

export function ProfileSettings({
  heading,
  loading,
}: {
  heading: ReactNode;
  loading: ReactNode;
}) {
  const profile = useQuery(api.profiles.current);

  return (
    <ProfileSettingsContent
      profile={profile}
      heading={heading}
      loading={loading}
    />
  );
}

export function PreloadedProfileSettings({
  preloaded,
  loading,
}: {
  preloaded: Preloaded<typeof api.profiles.current>;
  loading: ReactNode;
}) {
  const profile = usePreloadedQuery(preloaded);

  return <ProfileSettingsContent profile={profile} loading={loading} />;
}

function ProfileSettingsContent({
  profile,
  heading,
  loading,
}: {
  profile: Doc<"profiles"> | null | undefined;
  heading?: ReactNode;
  loading: ReactNode;
}) {
  if (!profile?.displayName)
    return (
      <div className="space-y-6">
        {heading}
        {loading}
      </div>
    );

  return (
    <ProfileEditor key={profile._id} profile={profile} heading={heading} />
  );
}

function ProfileEditor({
  profile,
  heading,
}: {
  profile: Doc<"profiles">;
  heading?: ReactNode;
}) {
  const update = useMutation(api.profiles.updatePublic);

  // A privately cached preload can be older than the live subscription. Follow
  // live values until the user edits, then preserve their unsaved draft.
  const [draft, setDraft] = useState<{
    displayName: string;
    bio: string;
  } | null>(null);

  const displayName = draft?.displayName ?? profile.displayName ?? "";
  const bio = draft?.bio ?? profile.bio ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();

        if (busy) return;
        setBusy(true);
        setSaved(false);
        setError(undefined);

        try {
          await update({ displayName, bio });
          setDraft(null);
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
      {heading}
      {profile.username ? (
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-muted/50 px-4 py-3 text-sm">
          <span className="truncate font-medium" title={`@${profile.username}`}>
            @{profile.username}
          </span>
          <Link
            href={profilePath(profile.username)}
            className="underline underline-offset-4"
          >
            View page ↗
          </Link>
        </div>
      ) : (
        <Link
          href="/username"
          className="flex min-h-11 items-center rounded-2xl bg-muted/50 px-4 py-3 text-sm font-medium underline underline-offset-4"
        >
          Choose your username ↗
        </Link>
      )}
      <label className="block text-sm font-medium">
        Display name
        <input
          required
          maxLength={60}
          autoComplete="name"
          value={displayName}
          disabled={busy}
          onChange={(event) => {
            setDraft({ displayName: event.target.value, bio });
            setSaved(false);
          }}
          className="mt-2 block min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base font-normal outline-ring"
        />
      </label>
      <label className="block text-sm font-medium">
        About you{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
        <input
          maxLength={160}
          value={bio}
          disabled={busy}
          onChange={(event) => {
            setDraft({ displayName, bio: event.target.value });
            setSaved(false);
          }}
          placeholder="A little about you and what you love"
          className="mt-2 block min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base font-normal outline-ring"
        />
        <span className="mt-2 block text-right text-xs font-normal text-muted-foreground">
          {bio.length}/160
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        <output className="text-xs text-muted-foreground">
          {saved ? "Profile saved." : ""}
        </output>
      </div>
    </form>
  );
}
