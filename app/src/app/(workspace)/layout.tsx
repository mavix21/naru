import type { ReactNode } from "react";

import { Suspense } from "react";

import { CompanionSettings } from "@/components/conversation/CompanionSettings";
import { HomeMenu } from "@/components/conversation/HomeMenu";
import { RecentOperations } from "@/components/conversation/RecentOperations";
import {
  HomeToolsLoading,
  PanelLoading,
  SocialMenusLoading,
} from "@/components/messaging/HomeLoading";
import { HomeShell } from "@/components/messaging/HomeShell";
import { MobileTools } from "@/components/messaging/MobileTools";
import { SessionMenu } from "@/components/messaging/SessionMenu";
import { AccountMenu } from "@/components/profile/AccountMenu";
import { IdentitySync } from "@/components/profile/IdentitySync";
import { People } from "@/components/social/People";
import { SocialMenus } from "@/components/social/SocialMenus";
import { getAuthConfig } from "@/lib/auth/config";
import {
  preloadWorkspace,
  workspaceSession,
  type WorkspaceData,
} from "@/lib/workspace";

export default function Layout({ children }: { children: ReactNode }) {
  // Without auth, each page renders its own setup notice.
  if (!getAuthConfig()) return children;

  // The shell stays mounted while moving between chats, wallet, and profile.
  return (
    <HomeShell
      tools={
        <Suspense fallback={<HomeToolsLoading />}>
          <Tools />
        </Suspense>
      }
      session={<SessionMenu />}
      reminder={<IdentitySync />}
    >
      {children}
    </HomeShell>
  );
}

async function Tools() {
  const session = await workspaceSession();

  // Pages own sign-in and onboarding redirects.
  if (!session?.companion) return <HomeToolsLoading />;
  const { companion, token, userId } = session;
  const data = preloadWorkspace(token);

  const accountPanel = (
    <Suspense fallback={<PanelLoading />}>
      <AccountDetails data={data} />
    </Suspense>
  );

  const activityPanel = (
    <Suspense fallback={<PanelLoading />}>
      <RecentActivity data={data} userId={userId} />
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
    <>
      <div className="hidden items-center gap-5 md:flex">
        <HomeMenu label="Account" compact>
          {accountPanel}
        </HomeMenu>
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
  );
}

async function AccountDetails({ data }: { data: WorkspaceData }) {
  const profile = await data.profile;

  return (
    <AccountMenu
      displayName={profile?.displayName || profile?.username || "Naru friend"}
      username={profile?.username}
    />
  );
}

async function RecentActivity({
  data,
  userId,
}: {
  data: WorkspaceData;
  userId: string;
}) {
  return <RecentOperations preloaded={await data.operations} userId={userId} />;
}

async function SocialControls({ data }: { data: WorkspaceData }) {
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
