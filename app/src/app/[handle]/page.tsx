import type { Metadata } from "next";

import { api } from "@naru/backend/api";
import { fetchQuery } from "convex/nextjs";
import { io } from "next/cache";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { Frame } from "@/components/onboarding/Frame";
import {
  canonicalProfileUrl,
  ProfileSharing,
} from "@/components/profile/ProfileSharing";
import { profilePath } from "@/lib/profile";

type Props = { params: Promise<{ handle: string }> };

const getProfile = cache(async (segment: string) => {
  let handle: string;

  try {
    handle = decodeURIComponent(segment);
  } catch {
    notFound();
  }

  if (!/^@[a-z][a-z0-9_]{2,23}$/i.test(handle)) notFound();
  await io();

  // Fresh, explicitly public snapshot: no Clerk, token, wallet or social reads.
  const profile = await fetchQuery(api.profiles.publicByUsername, {
    username: handle.slice(1),
  });

  if (!profile) notFound();

  if (handle !== `@${profile.username}`)
    permanentRedirect(profilePath(profile.username));

  return profile;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getProfile((await params).handle);
  const url = canonicalProfileUrl(profile.username);

  return {
    title: `${profile.displayName} (@${profile.username}) · Naru`,
    description:
      profile.bio ||
      `Meet ${profile.displayName} and ${profile.companion.name}.`,
    alternates: { canonical: url },
    openGraph: {
      url,
      title: `${profile.displayName} · Naru`,
      description: profile.bio || "A little corner of Naru.",
    },
  };
}

export default function Page(props: Props) {
  return (
    <Suspense
      fallback={
        <Frame>
          <output className="py-20 text-center text-sm text-muted-foreground">
            Meeting this Naru…
          </output>
        </Frame>
      }
    >
      <PublicProfile {...props} />
    </Suspense>
  );
}

async function PublicProfile({ params }: Props) {
  // The public snapshot and its metadata must both reflect owner edits on the
  // next request, including previously missing usernames. Opt into runtime IO.
  await connection();
  const profile = await getProfile((await params).handle);

  return (
    <Frame
      controls={
        <Link
          href="/create"
          className="text-xs font-medium underline underline-offset-4"
        >
          Meet your Naru ↗
        </Link>
      }
    >
      <article className="my-auto grid items-center gap-8 py-8 md:grid-cols-2 md:gap-16 md:py-16">
        <div className="flex flex-col items-center gap-5">
          <CompanionScene
            name={profile.companion.name}
            accent={profile.companion.accent}
          />
          <p className="text-[10px] font-medium tracking-[.14em] text-muted-foreground uppercase">
            A little company, a lot of personality
          </p>
        </div>
        <div className="mx-auto w-full min-w-0 max-w-110 space-y-7">
          <div className="space-y-3">
            <p className="text-[10px] font-semibold tracking-[.15em] text-muted-foreground uppercase">
              A little corner of Naru
            </p>
            <h1 className="text-4xl leading-[1.12] tracking-[-.055em] wrap-anywhere md:text-5xl">
              {profile.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            {profile.bio && (
              <p className="pt-2 text-sm leading-7 wrap-anywhere text-muted-foreground">
                {profile.bio}
              </p>
            )}
          </div>
          <div className="border-t border-border/70 pt-5">
            <p className="mb-5 text-xs leading-6 wrap-anywhere text-muted-foreground">
              Together with{" "}
              <span className="font-medium text-foreground">
                {profile.companion.name}
              </span>
              , their everyday companion.
            </p>
            <ProfileSharing username={profile.username} />
          </div>
        </div>
      </article>
    </Frame>
  );
}
