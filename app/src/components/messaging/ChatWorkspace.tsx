"use client";

import type { Id } from "@naru/backend/data-model";
import type { ReactNode } from "react";

import { api } from "@naru/backend/api";
import {
  IconArrowLeft,
  IconEdit,
  IconLock,
  IconSearch,
} from "@tabler/icons-react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PersonAvatar } from "@/components/social/Person";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  DirectConversation,
  MessagingBoundary,
  messageError,
} from "./DirectConversation";
import { openChat } from "./navigation";

function inboxTime(value: number) {
  const date = new Date(value);

  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatWorkspace({
  preloaded,
  social,
  userId,
  naruAvatar,
  controls,
  children,
}: {
  preloaded: Preloaded<typeof api.directMessages.inbox>;
  social: Preloaded<typeof api.social.current>;
  userId: string;
  naruAvatar: ReactNode;
  controls: ReactNode;
  children: ReactNode;
}) {
  const inbox = usePreloadedQuery(preloaded);
  const people = usePreloadedQuery(social);
  const params = useSearchParams();

  const selected =
    params?.get("chat") ??
    (params?.has("event") || params?.has("request") || params?.has("split")
      ? "naru"
      : null);

  const isNaru = !selected || selected === "naru";
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const start = useMutation(api.directMessages.start);

  useEffect(() => {
    const viewport = window.visualViewport;

    const resize = () =>
      document.documentElement.style.setProperty(
        "--naru-viewport",
        `${viewport?.height ?? window.innerHeight}px`,
      );

    resize();
    viewport?.addEventListener("resize", resize);

    return () => {
      viewport?.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--naru-viewport");
    };
  }, []);

  function choose(id: string) {
    setPicking(false);
    setSearch("");
    openChat(id);
  }

  const matches = (name: string, username: string) =>
    `${name} ${username}`.toLowerCase().includes(search.trim().toLowerCase());

  const conversations = inbox.conversations.filter((row) =>
    matches(row.person.displayName, row.person.username),
  );

  const friends = people.friends.filter((row) =>
    matches(row.person.displayName, row.person.username),
  );

  return (
    <div className="flex h-[var(--naru-viewport,100dvh)] min-h-0 flex-col overflow-hidden bg-background motion-reduce:**:animate-none motion-reduce:**:transition-none">
      <div
        className={cn(
          "shrink-0 border-b border-border/70",
          selected && "max-md:hidden",
        )}
      >
        {controls}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-400 flex-1 md:border-x md:border-border/60">
        <aside
          aria-label="Conversations"
          className={cn(
            "flex w-full shrink-0 flex-col md:w-76 md:border-r md:border-border/70 lg:w-85",
            selected && "max-md:hidden",
          )}
        >
          <div className="flex h-19 shrink-0 items-center justify-between px-5">
            <div className="flex items-center gap-2">
              {picking && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to conversations"
                  onClick={() => {
                    setPicking(false);
                    setSearch("");
                    setError(undefined);
                  }}
                >
                  <IconArrowLeft />
                </Button>
              )}
              <h1 className="text-xl font-semibold tracking-[-.04em]">
                {picking ? "New message" : "Chats"}
              </h1>
            </div>
            {!picking && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="New message"
                onClick={() => {
                  setPicking(true);
                  setSearch("");
                }}
              >
                <IconEdit className="size-5" />
              </Button>
            )}
          </div>
          <div className="px-4 pb-4">
            <label className="flex h-10 items-center gap-2.5 rounded-xl bg-muted/75 px-3 text-muted-foreground">
              <IconSearch className="size-4 shrink-0" />
              <input
                aria-label={picking ? "Search friends" : "Search chats"}
                placeholder={picking ? "Search friends" : "Search chats"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!picking && (
              <>
                <div className="px-3 pb-4">
                  <button
                    type="button"
                    onClick={() => choose("naru")}
                    aria-current={isNaru ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left outline-ring transition-colors hover:bg-muted/60",
                      isNaru && "bg-primary/[.07] max-md:bg-muted/50",
                    )}
                  >
                    <span className="size-11 shrink-0">{naruAvatar}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                        Your Naru{" "}
                        <IconLock className="size-3.5 text-muted-foreground" />
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        Your private money companion
                      </span>
                    </span>
                  </button>
                </div>
                <div className="mx-5 border-t border-border/70 pt-4 pb-2 text-[11px] font-medium text-muted-foreground">
                  Messages
                </div>
                {conversations.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => choose(row.id)}
                    aria-current={selected === row.id ? "true" : undefined}
                    aria-label={`${row.person.displayName}${row.unread ? `, ${row.unread} unread` : ""}`}
                    className={cn(
                      "relative flex w-full items-center gap-3 px-5 py-4 text-left outline-ring transition-colors hover:bg-muted/60",
                      selected === row.id &&
                        "bg-primary/[.07] before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r before:bg-primary",
                    )}
                  >
                    <PersonAvatar person={row.person} className="size-11" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            row.unread > 0 && "font-semibold",
                          )}
                        >
                          {row.person.displayName}
                        </span>
                        <time
                          suppressHydrationWarning
                          dateTime={new Date(row.updatedAt).toISOString()}
                          className={cn(
                            "shrink-0 text-[10px] text-muted-foreground",
                            row.unread > 0 && "text-primary",
                          )}
                        >
                          {inboxTime(row.updatedAt)}
                        </time>
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-xs text-muted-foreground",
                            row.unread > 0 && "text-foreground/80",
                          )}
                        >
                          {row.preview
                            ? `${row.fromMe ? "You: " : ""}${row.preview}`
                            : `Say hello to ${row.person.displayName}`}
                        </span>
                        {row.unread > 0 && (
                          <span className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                            {row.unread > 99 ? "99+" : row.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
                {!conversations.length && (
                  <div className="px-6 py-9 text-center">
                    <p className="text-sm text-muted-foreground">
                      {search
                        ? "No matching chats"
                        : "A little hello goes a long way."}
                    </p>
                    {!search && (
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-2"
                        onClick={() => setPicking(true)}
                      >
                        Message a friend
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
            {picking && (
              <>
                <p className="px-5 pt-1 pb-3 text-[11px] font-medium text-muted-foreground">
                  Your friends
                </p>
                {friends.map(({ person }) => (
                  <button
                    key={person.userId}
                    type="button"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy(person.userId);
                      setError(undefined);

                      try {
                        choose(await start({ friendId: person.userId }));
                      } catch (cause) {
                        setError(
                          messageError(
                            cause,
                            "Couldn’t open this chat. Try again.",
                          ),
                        );
                      } finally {
                        setBusy(undefined);
                      }
                    }}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left outline-ring hover:bg-muted/60 disabled:opacity-50"
                  >
                    <PersonAvatar person={person} className="size-11" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {person.displayName}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {busy === person.userId
                          ? "Opening…"
                          : `@${person.username}`}
                      </span>
                    </span>
                  </button>
                ))}
                {!friends.length && (
                  <p className="px-5 py-6 text-sm leading-6 text-muted-foreground">
                    {search
                      ? "No matching friends."
                      : "Add a friend in People to start a conversation."}
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="px-5 py-4 text-xs text-destructive"
                  >
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </aside>
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col",
            !selected && "max-md:hidden",
          )}
        >
          <div
            className={cn("flex min-h-0 flex-1 flex-col", !isNaru && "hidden")}
            aria-hidden={!isNaru || undefined}
          >
            {children}
          </div>
          {!isNaru && (
            <MessagingBoundary key={selected}>
              {/^[a-z0-9]{20,40}$/.test(selected) ? (
                <DirectConversation
                  key={selected}
                  // SAFETY: The URL matches Convex's ID shape; the query validates its table and membership server-side.
                  conversationId={selected as Id<"directConversations">}
                  userId={userId}
                />
              ) : (
                <div className="m-auto p-6 text-sm text-muted-foreground">
                  Conversation unavailable.{" "}
                  <Button variant="link" onClick={() => openChat(null)}>
                    Back to chats
                  </Button>
                </div>
              )}
            </MessagingBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
