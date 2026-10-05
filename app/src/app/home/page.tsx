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
import { ChatWorkspace } from "@/components/messaging/ChatWorkspace";
import { MobileTools } from "@/components/messaging/MobileTools";
import { SessionMenu } from "@/components/messaging/SessionMenu";
import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { ExperiencePage } from "@/components/onboarding/ExperiencePage";
import { Frame } from "@/components/onboarding/Frame";
import { People } from "@/components/social/People";
import { SocialMenus } from "@/components/social/SocialMenus";
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
  const [
    conversation,
    payments,
    operations,
    social,
    notifications,
    incomingPending,
    inbox,
  ] = await Promise.all([
    preloadQuery(api.conversations.current, {}, { token }),
    preloadQuery(api.payments.current, {}, { token }),
    preloadQuery(api.operations.recent, {}, { token }),
    preloadQuery(api.social.current, {}, { token }),
    preloadQuery(api.notifications.current, {}, { token }),
    preloadQuery(api.operations.pendingIncomingCount, {}, { token }),
    preloadQuery(api.directMessages.inbox, {}, { token }),
  ]);

  const accent = accents.find((option) => option.id === companion.accent)!;
  const accountPanel = <AccountPanel preloaded={payments} userId={userId} />;

  const activityPanel = (
    <RecentOperations preloaded={operations} userId={userId} />
  );

  const companionPanel = (
    <>
      <h2 className="text-sm font-medium">Make it yours.</h2>
      <CompanionSettings
        key={`${companion.name}-${companion.accent}`}
        companion={{ name: companion.name, accent: companion.accent }}
      />
    </>
  );

  return (
    <ChatWorkspace
      key={userId}
      userId={userId}
      preloaded={inbox}
      social={social}
      naruAvatar={
        <Image
          src={accent.image}
          alt=""
          width={64}
          height={64}
          className={`size-full rounded-full object-contain ${accent.surface}`}
        />
      }
      controls={
        <header className="mx-auto flex h-16 max-w-400 items-center justify-between gap-3 px-5 md:px-7">
          <Link
            href="/home"
            aria-label="Naru home"
            className="text-[29px] leading-none font-semibold tracking-[-1.8px] outline-ring"
          >
            naru<span className="text-primary">.</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3 md:gap-5">
            <nav
              aria-label="Your money and companion"
              className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-0 md:gap-5"
            >
              <div className="hidden items-center gap-5 md:flex">
                <HomeMenu label="Account">{accountPanel}</HomeMenu>
                <HomeMenu label="Activity">{activityPanel}</HomeMenu>
                <HomeMenu label="Companion">{companionPanel}</HomeMenu>
              </div>
              <MobileTools
                account={accountPanel}
                activity={activityPanel}
                companion={companionPanel}
              />
              <SocialMenus
                preloaded={notifications}
                people={<People preloaded={social} />}
              />
            </nav>
            <SessionMenu />
          </div>
        </header>
      }
    >
      <Conversation
        key={userId}
        userId={userId}
        name={companion.name}
        preloaded={conversation}
        preloadedOperations={operations}
        preloadedSocial={social}
        preloadedIncomingPending={incomingPending}
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
    </ChatWorkspace>
  );
}
