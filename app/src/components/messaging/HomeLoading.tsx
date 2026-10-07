import {
  IconArrowUp,
  IconBell,
  IconDots,
  IconEdit,
  IconLock,
  IconSearch,
} from "@tabler/icons-react";
import Link from "next/link";

import { LoadingStatus } from "@/components/LoadingStatus";

import { HomeShell } from "./HomeShell";
import { BackToChats } from "./navigation";

export function SocialMenusLoading() {
  return (
    <>
      <span className="py-2 text-xs text-muted-foreground">People</span>
      <span
        className="py-2 text-muted-foreground"
        aria-label="Notifications loading"
      >
        <IconBell className="size-4" />
      </span>
    </>
  );
}

export function HomeToolsLoading() {
  return (
    <>
      <div className="hidden items-center gap-5 text-xs text-muted-foreground md:flex">
        <span className="py-2">Account</span>
        <span className="py-2">Activity</span>
        <span className="py-2">Companion</span>
      </div>
      <IconDots className="size-5 text-muted-foreground md:hidden" />
      <SocialMenusLoading />
    </>
  );
}

export function PanelLoading() {
  return (
    <div className="space-y-3 py-2">
      <output className="sr-only">Loading details…</output>
      <div
        aria-hidden="true"
        className="h-5 w-28 rounded bg-muted motion-safe:animate-pulse"
      />
      <div
        aria-hidden="true"
        className="h-12 rounded-xl bg-muted motion-safe:animate-pulse"
      />
    </div>
  );
}

export function ConversationLoading() {
  return (
    <section
      aria-label="Loading conversation"
      aria-busy="true"
      className="relative mx-auto flex min-h-0 w-full flex-1 flex-col"
    >
      <div className="flex h-19 shrink-0 items-center gap-3 border-b border-border/70 px-4 md:px-7">
        <BackToChats />
        <div
          aria-hidden="true"
          className="size-10 shrink-0 rounded-full bg-muted motion-safe:animate-pulse"
        />
        <div>
          <p className="text-sm font-semibold">
            Your Naru{" "}
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              Private
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Your everyday companion
          </p>
        </div>
      </div>
      <div
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-end gap-6 overflow-hidden px-4 py-5 md:px-7 md:py-7"
        aria-hidden="true"
      >
        <div className="w-3/5 space-y-2 rounded-2xl bg-muted/60 p-5 motion-safe:animate-pulse">
          <div className="h-2 w-4/5 rounded bg-border/60" />
          <div className="h-2 w-3/5 rounded bg-border/60" />
        </div>
        <div className="h-12 w-2/5 self-end rounded-2xl bg-muted/60 motion-safe:animate-pulse" />
        <div className="w-2/3 space-y-2 rounded-2xl bg-muted/60 p-5 motion-safe:animate-pulse">
          <div className="h-2 rounded bg-border/60" />
          <div className="h-2 w-3/4 rounded bg-border/60" />
          <div className="h-2 w-1/2 rounded bg-border/60" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-7 md:pt-4 md:pb-4">
        <div className="flex items-center justify-between gap-3 rounded-[1.6rem] border border-border bg-card p-3 pl-5 shadow-[0_4px_24px_-12px_rgb(0_0_0/.15)]">
          <output className="text-sm text-muted-foreground">
            Opening your conversation…
          </output>
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <IconArrowUp className="size-4" />
          </span>
        </div>
        <p className="mt-2.5 text-center text-[10px] text-muted-foreground">
          A little company for your money.{" "}
          <span className="whitespace-nowrap">
            Practice money · you approve every payment.
          </span>
        </p>
      </div>
    </section>
  );
}

export function WorkspaceLoading() {
  return (
    <>
      <aside
        aria-label="Conversations"
        aria-busy="true"
        className="flex w-full shrink-0 flex-col max-md:group-has-data-[chat-selected]/workspace:hidden md:w-76 md:border-r md:border-border/70 lg:w-85"
      >
        <div className="flex h-19 shrink-0 items-center justify-between px-5">
          <h1 className="text-xl font-semibold tracking-[-.04em]">Chats</h1>
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center text-muted-foreground"
          >
            <IconEdit className="size-5" />
          </span>
        </div>
        <div className="px-4 pb-4">
          <div className="flex h-10 items-center gap-2.5 rounded-xl bg-muted/75 px-3 text-sm text-muted-foreground">
            <IconSearch className="size-4 shrink-0" />
            Search chats
          </div>
        </div>
        <div className="px-3 pb-4">
          <Link
            href="/home?chat=naru"
            className="flex w-full items-center gap-3 rounded-xl bg-primary/[.07] px-3 py-3 text-left outline-ring max-md:bg-muted/50"
          >
            <span
              aria-hidden="true"
              className="size-11 shrink-0 rounded-full bg-muted"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                Your Naru{" "}
                <IconLock className="size-3.5 text-muted-foreground" />
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                Your private money companion
              </span>
            </span>
          </Link>
        </div>
        <div className="mx-5 border-t border-border/70 pt-4 pb-2 text-[11px] font-medium text-muted-foreground">
          Messages
        </div>
        <output className="sr-only">Loading chats…</output>
        <div
          aria-hidden="true"
          className="overflow-hidden motion-safe:animate-pulse"
        >
          {["w-24", "w-32", "w-20"].map((width) => (
            <div key={width} className="flex items-center gap-3 px-5 py-4">
              <div className="size-11 shrink-0 rounded-full bg-muted" />
              <div className="flex-1 space-y-2.5">
                <div className={`h-3 rounded bg-muted ${width}`} />
                <div className="h-2.5 w-4/5 rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="relative hidden min-h-0 min-w-0 flex-1 flex-col group-has-data-[chat-selected]/workspace:flex md:flex">
        <ConversationLoading />
      </div>
    </>
  );
}

export function HomeLoading() {
  return (
    <HomeShell
      tools={<HomeToolsLoading />}
      session={
        <span aria-hidden="true" className="size-7 rounded-full bg-muted" />
      }
    >
      <WorkspaceLoading />
      <LoadingStatus />
    </HomeShell>
  );
}
