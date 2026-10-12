import type { ReactNode } from "react";

import {
  IconArrowLeft,
  IconLink,
  IconPencil,
  IconWallet,
} from "@tabler/icons-react";
import { cacheLife } from "next/cache";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const sections = {
  wallet: {
    label: "Wallet",
    title: "Your wallet",
    description: "Balances, wallet details, and test funds.",
    href: "/account",
    icon: IconWallet,
  },
  profile: {
    label: "Profile",
    title: "Edit profile",
    description: "Your name and bio appear on your public page.",
    href: "/account/profile",
    icon: IconPencil,
  },
  username: {
    label: "Public link",
    title: "Your public link",
    description: "Choose how friends find you on Naru.",
    href: "/username",
    icon: IconLink,
  },
} as const;

type Section = keyof typeof sections;

export async function AccountFrame({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}) {
  "use cache";

  // Only shared presentation lives here. Personalized tab content passes
  // through the children slot and retains its own private cache boundary.
  cacheLife("days");

  const current = sections[section];

  const links = Object.entries(sections).map(([id, item]) => ({
    ...item,
    active: id === section,
  }));

  return (
    <>
      <aside
        aria-label="Account"
        className="hidden w-76 shrink-0 flex-col border-r border-border/70 md:flex lg:w-85"
      >
        <div className="flex h-19 shrink-0 items-center gap-2 px-5">
          <Link
            href="/home"
            aria-label="Back to chats"
            className="-ml-2 flex size-8 items-center justify-center rounded-md text-muted-foreground outline-ring hover:bg-muted hover:text-foreground"
          >
            <IconArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <h1 className="text-xl font-semibold tracking-[-.04em]">Account</h1>
        </div>
        <nav aria-label="Account settings" className="space-y-1 px-3">
          {links.map(({ label, href, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              prefetch={true}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm outline-ring transition-colors hover:bg-muted/60",
                active && "bg-primary/[.07] font-medium",
              )}
            >
              <Icon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-19 shrink-0 items-center gap-3 border-b border-border/70 px-4 md:px-7">
          <Link
            href="/home"
            aria-label="Back to chats"
            className="-ml-1 flex size-9 items-center justify-center rounded-md outline-ring hover:bg-muted md:hidden"
          >
            <IconArrowLeft className="size-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">
                {current.title}
              </h2>
              {section === "wallet" && (
                <Badge variant="secondary">Testnet</Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {current.description}
            </p>
          </div>
        </div>
        <nav
          aria-label="Account settings"
          className="flex shrink-0 gap-5 overflow-x-auto border-b border-border/70 px-4 md:hidden"
        >
          {links.map(({ label, href, active }) => (
            <Link
              key={href}
              href={href}
              prefetch={true}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b-2 py-3 text-sm outline-ring",
                active
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-7 md:py-10">
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
