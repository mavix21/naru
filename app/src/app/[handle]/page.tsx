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
import { TipCheckout } from "@/components/tips/TipCheckout";
import { Skeleton } from "@/components/ui/skeleton";
import { accents } from "@/lib/companion-art";
import { profilePath } from "@/lib/profile";
import { TipService } from "@/lib/tips/server";
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
    <Suspense fallback={<PublicProfileSkeleton />}>
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

  // Server-side only: the page learns whether tips are possible, never the
  // owner's payment record. A lookup failure keeps the profile public.
  const receiving = await new TipService()
    .available(profile.username)
    .catch(() => null);

  return (
    <Frame
      className="max-w-6xl"
      controls={<ProfileSharing username={profile.username} />}
    >
      <article className="flex-1 pb-12">
        <div
          className={cn(
            "relative h-36 overflow-hidden rounded-3xl md:h-48",
            accent.surface,
          )}
        >
          <div
            aria-hidden="true"
            className={cn(
              "absolute -top-40 -left-12 size-96 rounded-full opacity-20 md:left-10",
              accent.swatch,
            )}
          />
          <div
            aria-hidden="true"
            className="absolute -right-16 -bottom-64 size-120 rounded-full border-[40px] border-white/40 md:right-10"
          />
          <div
            aria-hidden="true"
            className="absolute top-10 right-1/3 size-16 rounded-full border border-ring/15 md:size-24"
          />
          {/* The companion perches on the cover so it is visible without scrolling. */}
          <Image
            src={accent.image}
            alt={`${profile.companion.name}, the Naru bird`}
            width={192}
            height={192}
            sizes="(min-width: 768px) 176px, 112px"
            loading="eager"
            className="absolute right-3 -bottom-2 size-28 object-contain md:right-12 md:size-44"
          />
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
        <div className="mx-auto mt-10 grid max-w-4xl items-start gap-5 md:mt-12 md:grid-cols-[minmax(0,1fr)_20rem] md:gap-6">
          <div className="min-w-0 md:col-start-2 md:row-start-1">
            {receiving ? (
              <TipCheckout
                username={profile.username}
                displayName={profile.displayName}
              />
            ) : (
              <TipsUnavailable
                displayName={profile.displayName}
                reason={receiving === false ? "inactive" : "offline"}
              />
            )}
          </div>
          <section
            aria-labelledby="about-heading"
            className="min-w-0 rounded-3xl border bg-card p-6 md:col-start-1 md:row-start-1 md:p-8"
          >
            <h2 id="about-heading" className="text-base font-medium">
              About me
            </h2>
            <p className="mt-4 text-sm leading-7 wrap-anywhere text-muted-foreground">
              {profile.bio ||
                `A little corner of Naru, shared with ${profile.companion.name}.`}
            </p>
            <div className="mt-6 flex items-center gap-3 border-t pt-5">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", accent.swatch)}
              />
              <p className="min-w-0 text-sm text-muted-foreground">
                <span className="font-medium wrap-anywhere text-foreground">
                  {profile.companion.name}
                </span>{" "}
                is my everyday companion — a little company for life, and
                everything money.
              </p>
            </div>
          </section>
        </div>
      </article>
    </Frame>
  );
}

function PublicProfileSkeleton() {
  return (
    <Frame
      className="max-w-6xl"
      controls={
        <div className="h-10 w-34 overflow-hidden rounded-4xl">
          <Skeleton className="size-full" />
        </div>
      }
    >
      <output className="sr-only">Loading this profile…</output>
      <div aria-hidden="true" className="flex-1 pb-12">
        <div className="h-36 overflow-hidden rounded-3xl md:h-48">
          <Skeleton className="size-full" />
        </div>
        <div className="relative mx-auto -mt-12 flex max-w-xl flex-col items-center px-4">
          <div className="size-24 rounded-full border-[5px] border-background bg-background">
            <div className="size-full overflow-hidden rounded-full">
              <Skeleton className="size-full" />
            </div>
          </div>
          <div className="mt-5 flex h-9 items-center md:h-10">
            <Skeleton className="h-7 w-48 md:h-8 md:w-60" />
          </div>
          <Skeleton className="mt-2 h-4 w-24" />
          <div className="mt-4 h-7 w-44 overflow-hidden rounded-full">
            <Skeleton className="size-full" />
          </div>
        </div>
        <div className="mx-auto mt-10 grid max-w-4xl items-start gap-5 md:mt-12 md:grid-cols-[minmax(0,1fr)_20rem] md:gap-6">
          <div className="rounded-3xl border bg-card p-5 md:col-start-2 md:row-start-1 md:p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-full max-w-60" />
            <div className="mt-5 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((preset) => (
                <Skeleton key={preset} className="h-11" />
              ))}
            </div>
            <Skeleton className="mt-2 h-11" />
            <div className="mt-4 h-11 overflow-hidden rounded-4xl">
              <Skeleton className="size-full" />
            </div>
          </div>
          <div className="rounded-3xl border bg-card p-6 md:col-start-1 md:row-start-1 md:p-8">
            <Skeleton className="h-5 w-20" />
            <div className="mt-5 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="mt-6 flex items-center gap-3 border-t pt-5">
              <div className="size-2 shrink-0 overflow-hidden rounded-full">
                <Skeleton className="size-full" />
              </div>
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function TipsUnavailable({
  displayName,
  reason,
}: {
  displayName: string;
  reason: "inactive" | "offline";
}) {
  return (
    <section
      aria-labelledby="tip-heading"
      className="rounded-3xl border border-dashed bg-card p-5 md:p-6"
    >
      <h2 id="tip-heading" className="text-base font-medium">
        Tips aren’t available yet
      </h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {reason === "inactive"
          ? `${displayName} hasn’t activated a Naru payment account, so this profile can’t receive USDC tips yet.`
          : "Tipping is temporarily unavailable. Please check back soon."}
      </p>
      {reason === "inactive" && (
        <Link
          href="/activate"
          className="mt-4 inline-flex min-h-9 items-center gap-1 rounded-full border px-4 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Is this you? Activate payments
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
