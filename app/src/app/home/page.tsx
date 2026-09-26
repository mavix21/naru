import { UserButton } from "@clerk/nextjs";
import { api } from "@naru/backend/api";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { io } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AccountPanel } from "@/components/conversation/AccountPanel";
import { CompanionSettings } from "@/components/conversation/CompanionSettings";
import { Conversation } from "@/components/conversation/Conversation";
import { HomeMenu } from "@/components/conversation/HomeMenu";
import { RecentOperations } from "@/components/conversation/RecentOperations";
import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { ExperiencePage } from "@/components/onboarding/ExperiencePage";
import { Frame } from "@/components/onboarding/Frame";
import { getAuthConfig } from "@/lib/auth/config";
import { sessionIdentity } from "@/lib/auth/server";
import { accents } from "@/lib/companion-art";

export default function Page() {
  if (!getAuthConfig()) return <ExperiencePage screen="home" />;

  return (
    <Suspense
      fallback={
        <Frame>
          <div className="flex flex-1 items-center justify-center">
            <output className="text-sm text-muted-foreground">
              Getting your companion ready…
            </output>
          </div>
        </Frame>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}

async function AuthenticatedHome() {
  // Convex initializes random logging IDs before fetching. Defer that work
  // beyond the static shell while retaining prefetching and private live reads.
  await io();
  const session = await sessionIdentity();

  if (!session) redirect("/sign-in");
  const { userId, token } = session;
  // Companion settings are a fresh server snapshot; saving refreshes this tree.
  const companion = await fetchQuery(api.companions.current, {}, { token });

  if (!companion) return <ExperiencePage screen="home" />;

  if (!companion.paymentChoiceMade) redirect("/activate");

  // Private, live data: preload on the server, subscribe only in its interactive consumer.
  const [conversation, payments, operations] = await Promise.all([
    preloadQuery(api.conversations.current, {}, { token }),
    preloadQuery(api.payments.current, {}, { token }),
    preloadQuery(api.operations.recent, {}, { token }),
  ]);

  const accent = accents.find((option) => option.id === companion.accent)!;

  return (
    <Frame
      className="relative h-[var(--naru-viewport,100dvh)] min-h-0 max-md:px-4 [&>footer]:hidden max-md:[&>header]:gap-2 max-md:[&>header>div]:gap-2"
      controls={
        <>
          <nav
            aria-label="Your money and companion"
            className="flex items-center gap-3 md:gap-5"
          >
            <HomeMenu label="Account">
              <AccountPanel preloaded={payments} userId={userId} />
            </HomeMenu>
            <HomeMenu label="Activity">
              <RecentOperations preloaded={operations} userId={userId} />
            </HomeMenu>
            <HomeMenu label="Companion">
              <h2 className="text-sm font-medium">Make it yours.</h2>
              <CompanionSettings
                key={`${companion.name}-${companion.accent}`}
                companion={{ name: companion.name, accent: companion.accent }}
              />
            </HomeMenu>
          </nav>
          <UserButton />
        </>
      }
    >
      <Conversation
        key={userId}
        userId={userId}
        name={companion.name}
        preloaded={conversation}
        preloadedOperations={operations}
        presence={
          <Image
            src={accent.image}
            alt={`${companion.name}, your companion`}
            width={96}
            height={96}
            className={`size-full rounded-full object-contain ${accent.surface}`}
          />
        }
        welcome={
          <div className="flex flex-col items-center text-center">
            <div className="w-[clamp(130px,24dvh,235px)]">
              <CompanionScene name={companion.name} accent={companion.accent} />
            </div>
            <p className="mt-6 mb-3 text-[10px] font-medium tracking-[.13em] text-muted-foreground uppercase">
              Your everyday companion
            </p>
            <h1 className="text-[33px] leading-tight font-normal tracking-[-.055em] md:text-[40px]">
              Hello, you.
            </h1>
            <p className="mt-3 max-w-80 text-sm leading-7 text-muted-foreground">
              {companion.name} is here. What’s on your mind?
            </p>
          </div>
        }
        activation={
          <div className="my-4 rounded-2xl border p-4 text-sm">
            <p className="mb-2 text-muted-foreground">
              A passkey makes payments possible. Your conversation will be here
              when you’re back.
            </p>
            <Link
              href="/activate"
              className="font-medium underline underline-offset-4"
            >
              Activate payments ↗
            </Link>
          </div>
        }
      />
    </Frame>
  );
}
