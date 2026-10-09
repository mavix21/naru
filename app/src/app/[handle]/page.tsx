import type { Metadata } from "next";

import { api } from "@naru/backend/api";
import { fetchQuery } from "convex/nextjs";
import { io } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { Frame } from "@/components/onboarding/Frame";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import {
  canonicalProfileUrl,
  ProfileSharing,
} from "@/components/profile/ProfileSharing";
import { accents } from "@/lib/companion-art";
import { profilePath } from "@/lib/profile";
import { cn } from "@/lib/utils";

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
            Loading this profile…
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

  const accent = accents.find(
    (option) => option.id === profile.companion.accent,
  )!;

  return (
    <Frame
      className="max-w-6xl"
      controls={<ProfileSharing username={profile.username} />}
    >
      <article className="flex-1 pb-12">
        <div
          aria-hidden="true"
          className={cn(
            "relative h-36 overflow-hidden rounded-3xl md:h-48",
            accent.surface,
          )}
        >
          <div
            className={cn(
              "absolute -top-40 -left-12 size-96 rounded-full opacity-20 md:left-10",
              accent.swatch,
            )}
          />
          <div className="absolute -right-16 -bottom-64 size-120 rounded-full border-[40px] border-white/40 md:right-10" />
          <div className="absolute top-10 right-1/3 size-16 rounded-full border border-ring/15 md:size-24" />
        </div>
        <header className="relative mx-auto -mt-12 flex max-w-xl flex-col items-center px-4 text-center">
          <ProfileAvatar
            name={profile.displayName}
            accent={profile.companion.accent}
            className="size-24 border-[5px] border-background text-3xl shadow-sm"
          />
          <h1 className="mt-5 max-w-full text-3xl leading-tight font-medium tracking-[-.04em] wrap-anywhere md:text-4xl">
            {profile.displayName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            @{profile.username}
          </p>
          <p className="mt-4 flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", accent.swatch)}
            />
            <span className="wrap-anywhere">
              On Naru with {profile.companion.name}
            </span>
          </p>
        </header>
        <div className="mx-auto mt-10 grid max-w-4xl items-start gap-5 md:mt-12 md:grid-cols-[minmax(0,1fr)_19rem] md:gap-6">
          <section
            aria-labelledby="about-heading"
            className="min-w-0 rounded-3xl border bg-card p-6 md:p-8"
          >
            <h2 id="about-heading" className="text-base font-medium">
              About me
            </h2>
            <p className="mt-4 text-sm leading-7 wrap-anywhere text-muted-foreground">
              {profile.bio ||
                `A little corner of Naru, shared with ${profile.companion.name}.`}
            </p>
          </section>
          <aside
            aria-labelledby="companion-heading"
            className="overflow-hidden rounded-3xl border bg-card"
          >
            <div className={cn("flex justify-center py-3", accent.surface)}>
              <Image
                src={accent.image}
                alt={`${profile.companion.name}, the Naru bird`}
                width={192}
                height={192}
                sizes="192px"
                className="size-44 object-contain"
              />
            </div>
            <div className="p-6">
              <p className="text-xs text-muted-foreground">
                My everyday companion
              </p>
              <h2
                id="companion-heading"
                className="mt-2 text-xl font-medium tracking-tight wrap-anywhere"
              >
                Meet {profile.companion.name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                A little company for life, and everything money.
              </p>
            </div>
          </aside>
        </div>
        <div className="mt-12 text-center">
          <Link
            href="/create"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Meet your own Naru <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </article>
    </Frame>
  );
}
