import type { ReactNode } from "react";

import { IconArrowLeft, IconPencil, IconWallet } from "@tabler/icons-react";
import { cacheLife } from "next/cache";
import Link from "next/link";

import { Frame } from "@/components/onboarding/Frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export async function AccountFrame({
  section,
  children,
}: {
  section: "wallet" | "profile";
  children: ReactNode;
}) {
  "use cache";

  // Only shared presentation lives here. Personalized tab content passes
  // through the children slot and retains its own private cache boundary.
  cacheLife("days");

  return (
    <Frame>
      <section className="mx-auto w-full max-w-4xl flex-1 pt-6 pb-16 md:pt-10">
        <Link
          href="/home"
          className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <IconArrowLeft className="size-4" aria-hidden="true" />
          Back to Naru
        </Link>
        <p className="mb-3 text-xs text-muted-foreground">Your account</p>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-medium tracking-tight">
            {section === "wallet" ? "Your wallet" : "Edit profile"}
          </h1>
          {section === "wallet" && <Badge variant="secondary">Testnet</Badge>}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {section === "wallet"
            ? "Balances, wallet details, and test funds."
            : "Your name and bio appear on your public page."}
        </p>
        <nav
          aria-label="Account settings"
          className="mt-8 mb-8 flex gap-6 border-b"
        >
          {(
            [
              {
                id: "wallet",
                label: "Wallet",
                href: "/account",
                icon: IconWallet,
              },
              {
                id: "profile",
                label: "Profile",
                href: "/account/profile",
                icon: IconPencil,
              },
            ] as const
          ).map(({ id, label, href, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              prefetch={true}
              aria-current={id === section ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 py-4 text-sm focus-visible:outline-2 focus-visible:outline-ring",
                id === section
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </section>
    </Frame>
  );
}
