import {
  IconArrowUpRight,
  IconChevronRight,
  IconPencil,
  IconUser,
  IconWallet,
} from "@tabler/icons-react";
import Link from "next/link";

import { profilePath } from "@/lib/profile";

import { ProfileAvatar } from "./ProfileAvatar";

export function AccountMenu({
  displayName,
  username,
}: {
  displayName: string;
  username?: string;
}) {
  const items = [
    { label: "Wallet", href: "/account", icon: IconWallet, external: false },
    {
      label: username ? "View public profile" : "Choose a username",
      href: username ? profilePath(username) : "/username",
      icon: IconUser,
      external: Boolean(username),
    },
    {
      label: "Edit profile",
      href: "/account/profile",
      icon: IconPencil,
      external: false,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-3 border-b px-3 pt-2 pb-4">
        <ProfileAvatar name={displayName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {username ? `@${username}` : "Your account"}
          </p>
        </div>
      </div>
      <nav aria-label="Account" className="space-y-1">
        {items.map(({ label, href, icon: Icon, external }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1">{label}</span>
            {external ? (
              <IconArrowUpRight
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            ) : (
              <IconChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}
