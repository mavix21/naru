import type { api } from "@naru/backend/api";
import type { FunctionReturnType } from "convex/server";

import Image from "next/image";

import { accents } from "@/lib/companion-art";

export type PersonIdentity = NonNullable<
  FunctionReturnType<typeof api.social.current>["me"]
>;

export function PersonAvatar({
  person,
  className = "size-10",
}: {
  person: Pick<PersonIdentity, "accent" | "companionName">;
  className?: string;
}) {
  const art = accents.find((a) => a.id === person.accent)!;

  return (
    <Image
      src={art.image}
      width={64}
      height={64}
      alt={`${person.companionName}, Naru companion`}
      className={`${className} shrink-0 rounded-full object-contain ${art.surface}`}
    />
  );
}

export function Person({ person }: { person: PersonIdentity }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar person={person} />
      <div className="min-w-0 text-left">
        <p className="truncate text-sm font-medium">
          {person.displayName}{" "}
          <span className="font-normal text-muted-foreground">
            @{person.username}
          </span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          with {person.companionName}
        </p>
      </div>
    </div>
  );
}
