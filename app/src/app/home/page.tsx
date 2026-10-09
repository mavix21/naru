import type { Doc } from "@naru/backend/data-model";

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
import {
  ConversationLoading,
  HomeLoading,
  PanelLoading,
  SocialMenusLoading,
  WorkspaceLoading,
} from "@/components/messaging/HomeLoading";
import { HomeShell } from "@/components/messaging/HomeShell";
import { MobileTools } from "@/components/messaging/MobileTools";
import { SessionMenu } from "@/components/messaging/SessionMenu";
import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { ExperiencePage } from "@/components/onboarding/ExperiencePage";
import { IdentitySync } from "@/components/profile/IdentitySync";
import { ProfileSettings } from "@/components/profile/ProfileSettings";
import { ProfileSharing } from "@/components/profile/ProfileSharing";
import { People } from "@/components/social/People";
import { SocialMenus } from "@/components/social/SocialMenus";
import { getAuthConfig } from "@/lib/auth/config";
import { sessionIdentity } from "@/lib/auth/server";
import { accents } from "@/lib/companion-art";

export default function Page() {
  if (!getAuthConfig()) return <ExperiencePage screen="home" />;

  return (
    <Suspense fallback={<HomeLoading />}>
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

  // Start private live reads together, but stream each region as it becomes ready.
  const data = preloadHome(token);

  const accountPanel = (
    <Suspense fallback={<PanelLoading />}>
      <AccountDetails data={data} userId={userId} />
    </Suspense>
  );

  const activityPanel = (
    <Suspense fallback={<PanelLoading />}>
      <ActivityDetails data={data} userId={userId} />
    </Suspense>
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
    <HomeShell
      tools={
        <>
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
          <Suspense fallback={<SocialMenusLoading />}>
            <SocialControls data={data} />
          </Suspense>
        </>
      }
      session={<SessionMenu />}
      reminder={<IdentitySync key={userId} />}
    >
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace data={data} companion={companion} userId={userId} />
      </Suspense>
    </HomeShell>
  );
}

function preloadHome(token: string) {
  const data = {
    conversation: preloadQuery(api.conversations.current, {}, { token }),
    payments: preloadQuery(api.payments.current, {}, { token }),
    operations: preloadQuery(api.operations.recent, {}, { token }),
    social: preloadQuery(api.social.current, {}, { token }),
    notifications: preloadQuery(api.notifications.current, {}, { token }),
    incomingPending: preloadQuery(
      api.operations.pendingIncomingCount,
      {},
      { token },
    ),
    inbox: preloadQuery(api.directMessages.inbox, {}, { token }),
    profile: fetchQuery(api.profiles.current, {}, { token }),
  };

  // A nested region may not render until another read resolves. Observe early
  // rejections now; each region still receives and surfaces its original error.
  void Promise.allSettled(Object.values(data));

  return data;
}

type HomeData = ReturnType<typeof preloadHome>;

type HomeRegionProps = { data: HomeData; userId: string };

type WorkspaceProps = HomeRegionProps & { companion: Doc<"companions"> };

async function AccountDetails({ data, userId }: HomeRegionProps) {
  const [payments, profile] = await Promise.all([data.payments, data.profile]);

  return (
    <>
      <AccountPanel preloaded={payments} userId={userId} />
      <div className="mt-6 space-y-5 border-t pt-5">
        <ProfileSettings />
        {profile?.username && <ProfileSharing username={profile.username} />}
      </div>
    </>
  );
}

async function ActivityDetails({ data, userId }: HomeRegionProps) {
  return <RecentOperations preloaded={await data.operations} userId={userId} />;
}

async function SocialControls({ data }: { data: HomeData }) {
  const [notifications, social] = await Promise.all([
    data.notifications,
    data.social,
  ]);

  return (
    <SocialMenus
      preloaded={notifications}
      people={<People preloaded={social} />}
    />
  );
}

async function Workspace({ data, companion, userId }: WorkspaceProps) {
  const [inbox, social] = await Promise.all([data.inbox, data.social]);
  const accent = accents.find((option) => option.id === companion.accent)!;
  const conversationLoading = <ConversationLoading />;

  return (
    <ChatWorkspace
      key={userId}
      userId={userId}
      preloaded={inbox}
      social={social}
      conversationLoading={conversationLoading}
      naruAvatar={
        <Image
          src={accent.image}
          alt=""
          width={64}
          height={64}
          className={`size-full rounded-full object-contain ${accent.surface}`}
        />
      }
    >
      <Suspense fallback={conversationLoading}>
        <CompanionConversation
          data={data}
          companion={companion}
          userId={userId}
        />
      </Suspense>
    </ChatWorkspace>
  );
}

async function CompanionConversation({
  data,
  companion,
  userId,
}: WorkspaceProps) {
  const [conversation, operations, social, incomingPending] = await Promise.all(
    [data.conversation, data.operations, data.social, data.incomingPending],
  );

  const accent = accents.find((option) => option.id === companion.accent)!;

  return (
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
  );
}
