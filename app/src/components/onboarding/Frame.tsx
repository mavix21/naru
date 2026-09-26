import type { ReactNode } from "react";

import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Frame({
  children,
  controls,
  back,
  className,
}: {
  children: ReactNode;
  controls?: ReactNode;
  back?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-dvh max-w-7xl flex-col px-6 text-foreground md:px-9 lg:px-16 motion-reduce:**:animate-none motion-reduce:**:transition-none",
        className,
      )}
    >
      <header className="flex min-h-20 shrink-0 items-center justify-between gap-6 md:min-h-28">
        <Link
          href="/"
          className="rounded-sm text-[33px] leading-none font-semibold tracking-[-2px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          aria-label="Naru home"
        >
          naru
          <span className="text-ring" aria-hidden="true">
            .
          </span>
        </Link>
        <div className="flex items-center gap-5 md:gap-7">
          {back && (
            <Button
              render={<Link href={back} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
            >
              Back
            </Button>
          )}
          {controls}
        </div>
      </header>
      {children}
      <footer className="flex items-center justify-between gap-5 py-6 text-[10px] text-muted-foreground md:py-7 md:text-[11px]">
        <span>A little company for your money.</span>
        <span className="hidden text-[10px] tracking-wider uppercase md:block">
          Made for everyday life
        </span>
      </footer>
    </div>
  );
}

export function Scene({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 pt-3 pb-8 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10 md:pt-8 md:pb-18 lg:gap-24",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SceneCopy({
  children,
  className,
  live = false,
}: {
  children: ReactNode;
  className?: string;
  live?: boolean;
}) {
  return (
    <div
      aria-live={live ? "polite" : undefined}
      className={cn(
        "w-full min-w-0 max-w-100 pt-4 pb-1 md:max-w-108 md:py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-500",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 text-[10px] font-semibold tracking-[.13em] text-muted-foreground uppercase md:mb-5">
      {children}
    </p>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[33px] leading-[1.16] font-normal tracking-[-.055em] text-balance md:text-4xl lg:text-[46px]">
      {children}
    </h1>
  );
}

export function Description({ children }: { children: ReactNode }) {
  return (
    <p className="my-5 max-w-85 text-sm leading-8 text-pretty text-muted-foreground md:mb-7 md:text-[15px]">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive" className="my-4">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
