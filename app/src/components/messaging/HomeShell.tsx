import type { ReactNode } from "react";

import Link from "next/link";
import { Suspense } from "react";

import { WorkspaceState } from "./navigation";

export function HomeShell({
  tools,
  session,
  children,
}: {
  tools: ReactNode;
  session: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group/workspace flex h-[var(--naru-viewport,100dvh)] min-h-0 flex-col overflow-hidden bg-background motion-reduce:**:animate-none motion-reduce:**:transition-none">
      <Suspense fallback={null}>
        <WorkspaceState />
      </Suspense>
      <div className="shrink-0 border-b border-border/70 max-md:group-has-data-[chat-selected]/workspace:hidden">
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
              {tools}
            </nav>
            <div className="flex size-7 shrink-0 items-center justify-center">
              {session}
            </div>
          </div>
        </header>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-400 flex-1 md:border-x md:border-border/60">
        {children}
      </div>
    </div>
  );
}
