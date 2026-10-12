import type { Doc } from "@naru/backend/data-model";

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Conversation } from "@/components/conversation/Conversation";
import { LoadingStatus } from "@/components/LoadingStatus";
import { ChatWorkspace } from "@/components/messaging/ChatWorkspace";
import {
  ConversationLoading,
  WorkspaceLoading,
} from "@/components/messaging/HomeLoading";
import { CompanionScene } from "@/components/onboarding/CompanionScene";
import { ExperiencePage } from "@/components/onboarding/ExperiencePage";
import { getAuthConfig } from "@/lib/auth/config";
import { accents } from "@/lib/companion-art";
import {
  preloadWorkspace,
  workspaceSession,
  type WorkspaceData,
} from "@/lib/workspace";

export default function Page() {
  if (!getAuthConfig()) return <ExperiencePage screen="home" />;

  return (
    <Suspense
      fallback={
        <>
          <WorkspaceLoading />
          <LoadingStatus />
        </>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}

async function AuthenticatedHome() {
  const session = await workspaceSession();

  if (!session) redirect("/sign-in");
  const { companion, userId, token } = session;

  // Onboarding renders outside the workspace shell.
  if (!companion) redirect("/create");

  if (!companion.paymentChoiceMade) redirect("/activate");

  return (
    <Workspace
      data={preloadWorkspace(token)}
      companion={companion}
      userId={userId}
    />
  );
}

type WorkspaceProps = {
  data: WorkspaceData;
  userId: string;
  companion: Doc<"companions">;
};

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
