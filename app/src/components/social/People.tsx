"use client";

import type { Id } from "@naru/backend/data-model";

import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { api } from "@naru/backend/api";
import {
  IconArrowLeft,
  IconCheck,
  IconDots,
  IconLoader2,
  IconPencil,
  IconSearch,
  IconUserMinus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { PersonAvatar, type PersonIdentity } from "./Person";
import { UsernameForm } from "./UsernameForm";

function PeoplePerson({ person }: { person: PersonIdentity }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <PersonAvatar person={person} className="size-9" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{person.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{person.username}
        </p>
      </div>
    </div>
  );
}

export function People({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.social.current>;
}) {
  const data = usePreloadedQuery(preloaded);
  const search = useMutation(api.social.findUsername);
  const act = useMutation(api.social.friendAction);
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<PersonIdentity | null>();
  const [editing, setEditing] = useState(false);

  const [tab, setTab] = useState<"requests" | "friends">(() =>
    data.incoming.length ? "requests" : "friends",
  );

  const [pending, setPending] = useState<"search" | Id<"profiles"> | null>(
    null,
  );

  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const busy = pending !== null;

  async function action(
    personId: Id<"profiles">,
    action: "send" | "accept" | "decline" | "cancel" | "remove",
  ) {
    if (busy) return;
    setPending(personId);
    setError(undefined);
    setNotice(undefined);

    try {
      await act({ personId, action });
      setNotice(
        action === "send"
          ? "Friend request sent."
          : action === "accept"
            ? "You’re friends now."
            : action === "decline"
              ? "Request declined."
              : action === "cancel"
                ? "Request cancelled."
                : "Friend removed.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(null);
    }
  }

  if (!data.me || editing)
    return (
      <div className="overflow-y-auto p-5 md:p-6">
        {data.me && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-2"
            onClick={() => setEditing(false)}
          >
            <IconArrowLeft />
            Back
          </Button>
        )}
        <UsernameForm
          initial={data.me ?? undefined}
          onSaved={() => setEditing(false)}
        />
      </div>
    );

  const related = [...data.friends, ...data.incoming, ...data.outgoing].find(
    (r) => r.person.userId === found?.userId,
  );

  const requestCount = data.incoming.length + data.outgoing.length;

  function requestActions(person: PersonIdentity) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Decline request from ${person.displayName}`}
          title="Decline request"
          disabled={busy}
          onClick={() => void action(person.userId, "decline")}
        >
          <IconX className="size-4 text-muted-foreground" />
        </Button>
        <Button
          size="compact"
          aria-label={`Accept request from ${person.displayName}`}
          disabled={busy}
          onClick={() => void action(person.userId, "accept")}
        >
          Accept
        </Button>
      </div>
    );
  }

  return (
    <section
      id="people"
      aria-label="People"
      className="flex min-h-0 flex-col gap-4 p-5 md:p-6"
    >
      <h2 className="shrink-0 text-base font-medium tracking-tight">People</h2>
      <form
        className="shrink-0"
        onSubmit={async (event) => {
          event.preventDefault();

          if (busy) return;
          setPending("search");
          setError(undefined);
          setNotice(undefined);
          setFound(undefined);

          try {
            setFound(await search({ username }));
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Search unavailable.",
            );
          } finally {
            setPending(null);
          }
        }}
      >
        <label htmlFor="people-search" className="sr-only">
          Find a friend by exact username
        </label>
        <div className="flex items-center gap-2 rounded-2xl bg-muted/60 py-1.5 pr-2 pl-3 ring-1 ring-transparent transition-shadow focus-within:ring-ring/50">
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <input
            id="people-search"
            type="search"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFound(undefined);
              setError(undefined);
              setNotice(undefined);
            }}
            placeholder="Find by @username"
            maxLength={25}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-sm placeholder:text-muted-foreground md:text-sm"
          />
          <Button
            type="submit"
            variant="ghost"
            size="compact"
            disabled={busy || !username.trim()}
          >
            {pending === "search" ? (
              <>
                <IconLoader2 className="size-3.5 motion-safe:animate-spin" />
                <span className="sr-only">Searching</span>
              </>
            ) : (
              "Find"
            )}
          </Button>
        </div>
      </form>
      {found === null && (
        <output className="shrink-0 text-xs text-muted-foreground">
          No one found. Check the username.
        </output>
      )}
      {found && (
        <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-border/70 p-3">
          <PeoplePerson person={found} />
          {found.userId === data.me.userId ? (
            <span className="text-xs text-muted-foreground">You</span>
          ) : related?.state === "accepted" ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <IconCheck className="size-3.5" />
              Friends
            </span>
          ) : related?.incoming ? (
            requestActions(found)
          ) : related ? (
            <span className="text-xs text-muted-foreground">Pending</span>
          ) : (
            <Button
              size="compact"
              disabled={busy}
              onClick={() => void action(found.userId, "send")}
            >
              Add friend
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="shrink-0 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="block shrink-0 text-xs text-muted-foreground">
          {notice}
        </output>
      )}
      <Tabs.Root
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-col gap-3"
      >
        <Tabs.List
          aria-label="People lists"
          className="flex shrink-0 gap-1 rounded-xl bg-muted/60 p-1"
        >
          {[
            { value: "friends", label: "Friends", count: data.friends.length },
            { value: "requests", label: "Requests", count: requestCount },
          ].map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-active:bg-background data-active:text-foreground data-active:shadow-sm"
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab.value === "requests" && data.incoming.length ? "bg-primary/10 text-primary" : "bg-foreground/5 text-muted-foreground"}`}
                >
                  {tab.count}
                </span>
              )}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel
          value="friends"
          className="min-h-0 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {data.friends.length ? (
            <ul className="space-y-1">
              {data.friends.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 rounded-xl py-2"
                >
                  <PeoplePerson person={row.person} />
                  <Menu.Root>
                    <Menu.Trigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`Options for ${row.person.displayName}`}
                      disabled={busy}
                    >
                      <IconDots className="size-4 text-muted-foreground" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        align="end"
                        sideOffset={4}
                        className="z-50"
                      >
                        <Menu.Popup className="min-w-40 rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
                          <Menu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-destructive outline-none data-highlighted:bg-destructive/10"
                            disabled={busy}
                            onClick={() =>
                              void action(row.person.userId, "remove")
                            }
                          >
                            <IconUserMinus className="size-4" />
                            Remove friend
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
                <IconUsers className="size-5" stroke={1.5} />
              </span>
              <p className="text-sm font-medium">Better together</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Find a friend to get started.
              </p>
            </div>
          )}
        </Tabs.Panel>
        <Tabs.Panel
          value="requests"
          className="min-h-0 space-y-4 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {requestCount ? (
            <>
              {data.incoming.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs text-muted-foreground">
                    Received
                  </h3>
                  <ul className="space-y-1">
                    {data.incoming.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-2 rounded-xl py-2"
                      >
                        <PeoplePerson person={row.person} />
                        {requestActions(row.person)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.outgoing.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs text-muted-foreground">Sent</h3>
                  <ul className="space-y-1">
                    {data.outgoing.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-2 rounded-xl py-2"
                      >
                        <PeoplePerson person={row.person} />
                        <Button
                          variant="outline"
                          size="compact"
                          aria-label={`Cancel request to ${row.person.displayName}`}
                          disabled={busy}
                          onClick={() =>
                            void action(row.person.userId, "cancel")
                          }
                        >
                          Cancel
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
                <IconCheck className="size-5" stroke={1.5} />
              </span>
              <p className="text-sm font-medium">All caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New requests will appear here.
              </p>
            </div>
          )}
        </Tabs.Panel>
      </Tabs.Root>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-3">
        <p className="truncate text-xs text-muted-foreground">
          @{data.me.username}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit profile"
          title="Edit profile"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          <IconPencil className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </section>
  );
}
