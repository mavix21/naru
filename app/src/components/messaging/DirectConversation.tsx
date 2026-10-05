"use client";

import type { Id } from "@naru/backend/data-model";
import type { ReactNode } from "react";

import { api } from "@naru/backend/api";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconRefresh,
} from "@tabler/icons-react";
import {
  useConvexConnectionState,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";

import { PersonAvatar } from "@/components/social/Person";
import { Button } from "@/components/ui/button";
import { useDirectDraft } from "@/hooks/useDirectDraft";
import { cn } from "@/lib/utils";

import { BackToChats, openChat } from "./navigation";
import { SplitRequestMessage } from "./SplitRequestMessage";

export function messageError(cause: unknown, fallback: string) {
  return cause instanceof ConvexError
    ? (z.string().safeParse(cause.data).data ?? fallback)
    : fallback;
}

export class MessagingBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="m-auto p-8 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            This conversation couldn’t be loaded.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openChat(null)}>
              Back to chats
            </Button>
            <Button size="sm" onClick={() => this.setState({ failed: false })}>
              Try again
            </Button>
          </div>
        </div>
      );

    return this.props.children;
  }
}

function time(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);

  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function DirectConversation({
  conversationId,
  userId,
}: {
  conversationId: Id<"directConversations">;
  userId: string;
}) {
  // Selection is browser state; only this interactive thread subscribes to its history.
  const detail = useQuery(api.directMessages.detail, { conversationId });

  const { results, status, loadMore } = usePaginatedQuery(
    api.directMessages.history,
    { conversationId },
    { initialNumItems: 40 },
  );

  const send = useMutation(api.directMessages.send);
  const markRead = useMutation(api.directMessages.markRead);
  const connection = useConvexConnectionState();

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const connected = online && connection.isWebSocketConnected;

  const { draft, hydrated, updateDraft, readDraft } = useDirectDraft(
    userId,
    conversationId,
  );

  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [focused, setFocused] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const viewportSize = useRef({ width: 0, height: 0 });
  const composer = useRef<HTMLTextAreaElement>(null);
  const previous = useRef({ height: 0, oldest: 0, newest: 0 });
  const newest = results[0]?.sequence ?? 0;
  const oldest = results.at(-1)?.sequence ?? 0;
  const readSequence = detail?.readSequence;
  const loaded = !!detail;

  const acknowledged =
    !!draft.pending &&
    results.some(
      (row) =>
        row.clientId === draft.pending?.clientId &&
        row.author.profileId === detail?.me,
    );

  useEffect(() => {
    if (!acknowledged) return;
    updateDraft((current) =>
      current.pending?.clientId === draft.pending?.clientId
        ? { text: current.text }
        : current,
    );
  }, [acknowledged, draft.pending?.clientId, updateDraft]);

  useEffect(() => {
    const update = () =>
      setFocused(document.visibilityState === "visible" && document.hasFocus());

    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (
      !focused ||
      !atBottom ||
      readSequence === undefined ||
      newest <= readSequence
    )
      return;

    const timer = setTimeout(() => {
      void markRead({ conversationId, throughSequence: newest })
        .then(() => setReadError(false))
        .catch(() => setReadError(true));
    }, 180);

    return () => clearTimeout(timer);
  }, [
    focused,
    atBottom,
    newest,
    readSequence,
    conversationId,
    markRead,
    readAttempt,
  ]);

  useLayoutEffect(() => {
    const element = viewport.current;

    if (!element) return;
    const before = previous.current;

    if (before.oldest && oldest < before.oldest)
      element.scrollTop += element.scrollHeight - before.height;
    else if (atBottom || !before.newest)
      element.scrollTop = element.scrollHeight;
    previous.current = { height: element.scrollHeight, oldest, newest };
  }, [oldest, newest, draft.pending, detail, status, atBottom]);

  useLayoutEffect(() => {
    const element = viewport.current;

    if (!element) return;

    // Keep the latest message visible through keyboard, composer, and breakpoint resizing.
    const resize = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
      viewportSize.current = {
        width: element.clientWidth,
        height: element.clientHeight,
      };
    };

    const observer = new ResizeObserver(resize);
    observer.observe(element);

    if (element.firstElementChild) observer.observe(element.firstElementChild);
    resize();

    return () => observer.disconnect();
  }, [loaded]);

  useLayoutEffect(() => {
    const input = composer.current;

    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    }
  }, [draft.text, detail]);

  async function submit(retry = false) {
    const current = readDraft();

    if (
      inFlight.current ||
      !hydrated ||
      !detail?.canSend ||
      (!retry && current.pending)
    )
      return;

    const pending = retry
      ? current.pending
      : {
          clientId: crypto.randomUUID(),
          text: current.text,
        };

    if (!pending?.text.trim()) return;
    inFlight.current = true;
    setSending(true);
    setError(undefined);
    pinned.current = true;
    setAtBottom(true);

    // Persist the id before dispatch: a reload/lost acknowledgement retries the same message.
    if (!retry) updateDraft(() => ({ text: "", pending }));

    try {
      await send({
        conversationId,
        clientId: pending.clientId,
        text: pending.text,
      });
      updateDraft((value) =>
        value.pending?.clientId === pending.clientId
          ? { text: value.text }
          : value,
      );
    } catch (cause) {
      setError(
        messageError(
          cause,
          "Couldn’t send. Your message is saved here; try again.",
        ),
      );
    } finally {
      inFlight.current = false;
      setSending(false);
      composer.current?.focus();
    }
  }

  if (!detail)
    return (
      <section
        className="flex min-h-0 flex-1 flex-col"
        aria-label="Loading conversation"
      >
        <header className="flex h-19 items-center gap-3 border-b px-4">
          <BackToChats />
          <div className="size-10 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        </header>
        <output className="m-auto text-sm text-muted-foreground">
          Loading messages…
        </output>
      </section>
    );

  const messages = [...results].reverse();

  return (
    <section
      aria-label={`Conversation with ${detail.person.displayName}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-19 shrink-0 items-center gap-3 border-b border-border/70 px-4 md:px-7">
        <BackToChats />
        <PersonAvatar person={detail.person} className="size-10" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {detail.person.displayName}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            @{detail.person.username}
          </p>
        </div>
      </header>
      {!connected && (
        <output className="border-b bg-muted/40 px-5 py-2 text-center text-xs text-muted-foreground">
          Reconnecting… Messages will sync when you’re back online.
        </output>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col bg-muted/15">
        <div
          ref={viewport}
          role="log"
          aria-label={`Messages with ${detail.person.displayName}`}
          aria-relevant="additions"
          // Keyboard users must be able to focus and scroll the message history.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          onScroll={() => {
            const el = viewport.current;

            if (
              !el ||
              el.clientWidth !== viewportSize.current.width ||
              el.clientHeight !== viewportSize.current.height
            )
              return;
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 64;
            setAtBottom(pinned.current);
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 outline-ring [overflow-anchor:none] md:px-8 md:py-7"
        >
          <div className="mx-auto flex min-h-full max-w-3xl flex-col">
            {(status === "CanLoadMore" || status === "LoadingMore") && (
              <div className="mb-5 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={status === "LoadingMore"}
                  onClick={() => loadMore(40)}
                >
                  {status === "LoadingMore" ? "Loading…" : "Earlier messages"}
                </Button>
              </div>
            )}
            {status === "LoadingFirstPage" && (
              <output className="m-auto text-sm text-muted-foreground">
                Loading messages…
              </output>
            )}
            {status !== "LoadingFirstPage" &&
              !messages.length &&
              !draft.pending && (
                <div className="m-auto flex flex-col items-center px-4 py-12 text-center">
                  <PersonAvatar person={detail.person} className="size-16" />
                  <h3 className="mt-4 text-base font-medium">
                    {detail.person.displayName}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Say hello. This is the start of your conversation.
                  </p>
                </div>
              )}
            <div className="mt-auto">
              {messages.map((message, index) => {
                const own = message.author.profileId === detail.me;
                const before = messages[index - 1];

                const newDay =
                  !before ||
                  new Date(before._creationTime).toDateString() !==
                    new Date(message._creationTime).toDateString();

                const grouped =
                  !newDay &&
                  before?.kind === message.kind &&
                  before?.author.profileId === message.author.profileId &&
                  message._creationTime - before._creationTime < 300_000;

                return (
                  <div key={message._id}>
                    {newDay && (
                      <div className="my-6 text-center text-[11px] text-muted-foreground">
                        <time
                          dateTime={new Date(
                            message._creationTime,
                          ).toISOString()}
                        >
                          {new Date(message._creationTime).toLocaleDateString(
                            [],
                            { month: "long", day: "numeric", year: "numeric" },
                          )}
                        </time>
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex",
                        own ? "justify-end" : "justify-start",
                        grouped ? "mt-1" : "mt-4",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[86%] rounded-2xl px-3.5 py-2.5 md:max-w-[75%]",
                          own
                            ? "rounded-br-md bg-primary/[.09]"
                            : "rounded-bl-md border border-border/50 bg-background",
                        )}
                      >
                        {message.kind === "split_request" &&
                        message.requestId ? (
                          <SplitRequestMessage id={message.requestId} />
                        ) : (
                          <p
                            dir="auto"
                            className="text-sm leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]"
                          >
                            {message.text}
                          </p>
                        )}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                          <time
                            dateTime={new Date(
                              message._creationTime,
                            ).toISOString()}
                          >
                            {time(message._creationTime)}
                          </time>
                          {own && (
                            <IconCheck className="size-3" aria-label="Sent" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {draft.pending && !acknowledged && (
                <div className="mt-4 flex flex-col items-end">
                  <div className="max-w-[86%] rounded-2xl rounded-br-md bg-primary/[.06] px-3.5 py-2.5 md:max-w-[75%]">
                    <p
                      dir="auto"
                      className="text-sm leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]"
                    >
                      {draft.pending.text}
                    </p>
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">
                      {sending
                        ? connected
                          ? "Sending…"
                          : "Waiting for connection…"
                        : "Not sent"}
                    </p>
                  </div>
                  {!sending && (
                    <div className="mt-2 max-w-sm text-right">
                      <p role="alert" className="text-xs text-destructive">
                        {error ??
                          "Send interrupted. Retry to confirm delivery."}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        disabled={!detail.canSend}
                        onClick={() => void submit(true)}
                      >
                        <IconRefresh /> Retry message
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {!atBottom && (
          <Button
            size="sm"
            variant="outline"
            className="absolute right-5 bottom-4"
            onClick={() => {
              pinned.current = true;
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
                behavior: "smooth",
              });
              setAtBottom(true);
            }}
          >
            <IconArrowDown /> Latest messages
          </Button>
        )}
      </div>
      <div className="shrink-0 border-t border-border/60 bg-background px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] md:px-7 md:py-4">
        {readError && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between text-xs text-muted-foreground"
          >
            Couldn’t update unread status.
            <Button
              variant="link"
              size="xs"
              onClick={() => setReadAttempt((n) => n + 1)}
            >
              Retry
            </Button>
          </div>
        )}
        {!detail.canSend ? (
          <p className="py-2 text-center text-xs leading-5 text-muted-foreground">
            You’re no longer friends. Your conversation history is still here.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border/70 bg-muted/35 p-2 focus-within:border-ring"
          >
            <textarea
              ref={composer}
              aria-label={`Message ${detail.person.displayName}`}
              placeholder="Write a message…"
              rows={1}
              maxLength={4000}
              value={draft.text}
              disabled={!hydrated}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  text: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  window.matchMedia("(min-width: 768px)").matches
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              className="max-h-30 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-5 outline-none placeholder:text-muted-foreground md:text-sm"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={
                !hydrated || !draft.text.trim() || sending || !!draft.pending
              }
            >
              <IconArrowUp className="size-5" />
            </Button>
          </form>
        )}
        {draft.text.length > 3800 && (
          <p className="mx-auto mt-1 max-w-3xl text-right text-[10px] text-muted-foreground">
            {draft.text.length.toLocaleString()} / 4,000
          </p>
        )}
      </div>
    </section>
  );
}
