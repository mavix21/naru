"use client";

import { api } from "@naru/backend/api";
import { IconBell } from "@tabler/icons-react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { PersonAvatar } from "./Person";
import { requestLabels } from "./SplitCard";

const labels = new Map([
  ["friend_request", "invited you to be friends"],
  ["friend_accepted", "accepted your invitation"],
  ["split_request", "sent a split request"],
  ["reply", "sent a reply"],
  ["declined", "declined a request"],
  ["cancelled", "cancelled a request"],
  ["paid", "payment confirmed"],
]);

export function SocialMenus({
  preloaded,
  people,
}: {
  preloaded: Preloaded<typeof api.notifications.current>;
  people: ReactNode;
}) {
  const data = usePreloadedQuery(preloaded);
  const markRead = useMutation(api.notifications.markRead);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <>
      <Popover open={peopleOpen} onOpenChange={setPeopleOpen}>
        <PopoverTrigger variant="homeMenu">People</PopoverTrigger>
        <PopoverContent
          align="end"
          variant="homeMenu"
          aria-label="People"
          className="max-h-[70dvh] w-[calc(100vw-2rem)] overflow-y-auto md:w-96"
        >
          {people}
        </PopoverContent>
      </Popover>
      <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
        <PopoverTrigger
          variant="homeMenu"
          className="relative"
          aria-label={`Notifications, ${data.unread} unread`}
        >
          <IconBell className="size-4" />
          {data.unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-3.5 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
              {data.unread > 99 ? "99+" : data.unread}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          variant="homeMenu"
          aria-label="Notifications"
          className="max-h-[70dvh] w-[calc(100vw-2rem)] overflow-y-auto md:w-96"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">A little news.</h2>
            {data.unread > 0 && (
              <Button
                size="xs"
                variant="ghost"
                onClick={async () => {
                  try {
                    await markRead({});
                  } catch {
                    setError("Couldn’t mark notifications read.");
                  }
                }}
              >
                Mark all read
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {!data.items.length && (
            <p className="text-xs leading-6 text-muted-foreground">
              Friend invitations, requests, and replies will arrive here.
            </p>
          )}
          <div className="space-y-1">
            {data.items.map((item) => (
              <button
                key={item._id}
                type="button"
                className={`flex w-full gap-3 rounded-2xl p-3 text-left outline-ring hover:bg-muted/50 ${item.read ? "" : "bg-muted/40"}`}
                onClick={async () => {
                  setError(undefined);

                  try {
                    await markRead({ id: item._id });
                  } catch {
                    setError("Couldn’t mark this notification read.");

                    return;
                  }

                  setInboxOpen(false);

                  if (item.friendshipId) setPeopleOpen(true);
                  else if (item.messageId)
                    router.push(
                      `/home?event=${encodeURIComponent(item.messageId)}`,
                    );
                  else if (item.requestId)
                    router.push(`/home?request=${item.requestId}`);
                  else if (item.splitId)
                    router.push(`/home?split=${item.splitId}`);
                }}
              >
                <PersonAvatar person={item.actor} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-5">
                    <strong className="font-medium">
                      {item.actor.displayName}
                    </strong>{" "}
                    · {labels.get(item.kind) ?? "New activity"}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {item.requestState
                      ? requestLabels[item.requestState]
                      : item.friendState
                        ? `Friendship: ${item.friendState}`
                        : "Delivered"}
                  </span>
                </span>
                {!item.read && (
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
