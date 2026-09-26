"use client";

import type { Doc } from "@naru/backend/data-model";
import type { FunctionReturnType } from "convex/server";

import { useChat } from "@ai-sdk/react";
import { api } from "@naru/backend/api";
import { DefaultChatTransport, type UIMessage } from "ai";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { FocusedSocialCard } from "@/components/social/FocusedSocialCard";
import {
  MentionComposer,
  MentionText,
} from "@/components/social/MentionComposer";
import { SocialEvent } from "@/components/social/SocialEvent";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useMessageDraft } from "@/hooks/useMessageDraft";
import { conversationRequest } from "@/lib/conversation/client";
import { mentionMetadata, type Mention } from "@/lib/mentions";

import { TransferCard } from "./TransferCard";

type Snapshot = FunctionReturnType<typeof api.conversations.current>;

type ConversationMessage = UIMessage<{
  mentions?: Mention[];
  socialEvent?: NonNullable<Doc<"messages">["event"]>;
}>;

function readableError(error: Error) {
  try {
    const value = z
      .object({ error: z.string() })
      .safeParse(JSON.parse(error.message));

    if (value.success) return value.data.error;
  } catch {
    /* SDK transport errors may already be plain text. */
  }

  return error.message;
}

const inactive = z.object({ active: z.literal(false) });

const balance = z.object({
  active: z.literal(true),
  amount: z.string(),
  asset: z.literal("XLM"),
  observedAt: z.iso.datetime(),
});

function BalanceResult({
  output,
  activation,
}: {
  output: unknown;
  activation: ReactNode;
}) {
  if (inactive.safeParse(output).success) return activation;
  const result = balance.safeParse(output);

  if (!result.success) return null;
  const value = result.data;

  return (
    <Card className="my-5 w-full max-w-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-5"
              focusable="false"
            >
              <path d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" />
            </svg>
          </span>
          <CardTitle>Balance</CardTitle>
        </div>
        <Badge variant="secondary">
          <span className="sr-only">Stellar </span>Testnet
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 text-5xl leading-none font-medium tracking-tighter break-all tabular-nums">
            {value.amount}
          </span>{" "}
          <span className="text-base text-muted-foreground">{value.asset}</span>
        </p>
      </CardContent>
    </Card>
  );
}

export function Conversation({
  preloaded,
  preloadedOperations,
  preloadedSocial,
  preloadedIncomingPending,
  userId,
  name,
  welcome,
  presence,
  activation,
}: {
  preloaded: Preloaded<typeof api.conversations.current>;
  preloadedOperations: Preloaded<typeof api.operations.recent>;
  preloadedSocial: Preloaded<typeof api.social.current>;
  preloadedIncomingPending: Preloaded<
    typeof api.operations.pendingIncomingCount
  >;
  userId: string;
  name: string;
  welcome: ReactNode;
  presence: ReactNode;
  activation: ReactNode;
}) {
  const snapshot = usePreloadedQuery(preloaded);
  const recent = usePreloadedQuery(preloadedOperations);
  const social = usePreloadedQuery(preloadedSocial);
  const incomingPending = usePreloadedQuery(preloadedIncomingPending);
  const [older, setOlder] = useState<Snapshot["messages"]>([]);

  const [olderOperations, setOlderOperations] = useState<
    Snapshot["operations"]
  >([]);

  const [overrides, setOverrides] = useState<Snapshot["operations"]>([]);
  const [more, setMore] = useState<boolean>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const { draft, mentions, updateDraft, hydrated } = useMessageDraft(userId);
  const [now, setNow] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sent = useRef<{ id: string; text: string } | null>(null);
  const sequences = useRef(new Map<string, number>());

  const records = useMemo(
    () =>
      [
        ...new Map(
          [...older, ...snapshot.messages].map((row) => [row.messageId, row]),
        ).values(),
      ].sort((a, b) => a.sequence - b.sequence),
    [older, snapshot.messages],
  );

  const saved = useMemo(
    () =>
      records.map((row) => {
        // SAFETY: UIMessage content is written only by trusted conversation and
        // event functions. Social references below come from validated DB fields.
        const message = JSON.parse(row.content) as ConversationMessage;

        return {
          ...message,
          metadata: { mentions: row.mentions ?? [], socialEvent: row.event },
        };
      }),
    [records],
  );

  const operations = useMemo(() => {
    const map = new Map<string, Doc<"operations">>();

    for (const operation of [
      ...olderOperations,
      ...snapshot.operations,
      ...recent,
      ...overrides,
    ]) {
      if ((map.get(operation._id)?.updatedAt ?? 0) <= operation.updatedAt)
        map.set(operation._id, operation);
    }

    return [...map.values()];
  }, [olderOperations, snapshot.operations, recent, overrides]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ConversationMessage>({
        api: "/api/chat",
        headers: { "X-Naru-User": userId },
        prepareSendMessagesRequest: ({ messages }) => {
          const message = messages[messages.length - 1];

          return {
            body: {
              message: {
                id: message.id,
                role: "user",
                mentions:
                  mentionMetadata.safeParse(message.metadata).data?.mentions ??
                  [],
                parts: [
                  {
                    type: "text",
                    text: message.parts
                      .flatMap((p) => (p.type === "text" ? [p.text] : []))
                      .join("\n"),
                  },
                ],
              },
            },
          };
        },
      }),
    [userId],
  );

  const { messages, sendMessage, setMessages, status, error, clearError } =
    useChat<ConversationMessage>({
      id: `naru-${userId}`,
      messages: saved,
      transport,
    });

  const streaming = status === "streaming" || status === "submitted";

  const serverBusy =
    !!snapshot.conversation?.activeTurn &&
    (now === 0 || snapshot.conversation.activeUntil > now);

  const started = messages.length > 0 || saved.length > 0;

  const pending =
    incomingPending > 0 ||
    recent.some((operation) => operation.state === "submitting");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    for (const row of records)
      sequences.current.set(row.messageId, row.sequence);

    if (!streaming && !serverBusy) {
      setMessages((previous) => {
        // Retain the already-read window as the live query advances. Unsaved
        // failed submissions disappear from history but remain in the composer.
        const merged = new Map(
          previous
            .filter((message) => sequences.current.has(message.id))
            .map((message) => [message.id, message]),
        );

        for (const message of saved) merged.set(message.id, message);

        return [...merged.values()].sort(
          (a, b) => sequences.current.get(a.id)! - sequences.current.get(b.id)!,
        );
      });
    }
  }, [records, saved, streaming, serverBusy, setMessages]);
  useEffect(() => {
    if (
      sent.current &&
      snapshot.messages.some((row) => row.messageId === sent.current?.id)
    ) {
      if (draft === sent.current.text) updateDraft("");
      sent.current = null;
    }
  }, [snapshot.messages, draft, updateDraft]);

  // VisualViewport follows the mobile keyboard, including Safari's non-resizing layout viewport.
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
  useLayoutEffect(() => {
    const input = composer.current;

    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    }
  }, [draft]);

  const reconcile = useCallback(async () => {
    try {
      await conversationRequest(userId, "/api/transfers");
      setSyncError(undefined);
    } catch {
      setSyncError(
        "Couldn’t refresh transfer status. Saved cards are shown; check again before repeating a payment.",
      );
    }
  }, [userId]);

  useEffect(() => {
    if (!recent.length && !incomingPending) return;
    let running = false;

    const check = async () => {
      if (running) return;
      running = true;
      await reconcile();
      running = false;
    };

    void check();

    const interval = pending
      ? setInterval(() => void check(), 6000)
      : undefined;

    window.addEventListener("online", check);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", check);
    };
  }, [pending, recent.length, incomingPending, reconcile]);

  async function submit(text = draft) {
    if (!text.trim() || streaming || serverBusy || !hydrated) return;
    clearError();
    const id = crypto.randomUUID();
    sent.current = { id, text };
    updateDraft(text);
    await sendMessage({
      id,
      role: "user",
      parts: [{ type: "text", text }],
      metadata: { mentions: text === draft ? mentions : [] },
    });
  }

  const onOperationUpdate = (operation: Doc<"operations">) =>
    setOverrides((previous) => [
      ...previous.filter((o) => o._id !== operation._id),
      operation,
    ]);

  const interrupted =
    snapshot.conversation?.activeTurn && !serverBusy && !streaming;

  const latest = operations.toSorted(
    (a, b) => b._creationTime - a._creationTime,
  )[0];

  const delight = latest?.state === "confirmed";

  const presenceText = pending
    ? "Waiting for network confirmation"
    : delight
      ? "Last transfer sent and confirmed."
      : latest?.state === "awaiting_approval"
        ? "A moment to review."
        : streaming || serverBusy
          ? "Thinking with you…"
          : "Right here with you.";

  return (
    <section
      aria-label={`Conversation with ${name}`}
      className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
    >
      {started && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border/50 pb-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
          <div
            data-delight={delight}
            className="naru-presence size-12 shrink-0"
          >
            {presence}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <output className="mt-0.5 block text-[11px] text-muted-foreground">
              {presenceText}
            </output>
          </div>
        </div>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label={`Messages with ${name}`}>
            <div className="flex min-h-full flex-col px-1 py-5 md:px-5 md:py-9">
              <MessageScrollerContent
                aria-busy={streaming || serverBusy}
                className="flex-1"
              >
                <FocusedSocialCard userId={userId} />
                {!started ? (
                  <MessageScrollerItem
                    messageId="welcome"
                    className="flex flex-1 flex-col items-center justify-center"
                  >
                    {welcome}
                    <div className="mt-5 flex flex-wrap justify-center gap-2 pb-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hydrated || streaming || serverBusy}
                        onClick={() => void submit("What’s my balance?")}
                      >
                        Check my balance <span aria-hidden="true">↗</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hydrated || streaming || serverBusy}
                        onClick={() => void submit("I’d like to send money.")}
                      >
                        Send money <span aria-hidden="true">↗</span>
                      </Button>
                    </div>
                  </MessageScrollerItem>
                ) : (
                  <>
                    {((more ?? snapshot.hasMore) || historyError) && (
                      <MessageScrollerItem
                        messageId="history"
                        className="text-center"
                      >
                        {(more ?? snapshot.hasMore) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={loadingOlder}
                            onClick={async () => {
                              const first = messages[0];

                              if (!first) return;
                              setLoadingOlder(true);
                              setHistoryError(undefined);

                              try {
                                const page =
                                  await conversationRequest<Snapshot>(
                                    userId,
                                    `/api/chat?before=${sequences.current.get(first.id)}`,
                                  );

                                setOlder((previous) => [
                                  ...page.messages,
                                  ...previous,
                                ]);
                                setOlderOperations((previous) => [
                                  ...page.operations,
                                  ...previous,
                                ]);
                                setMore(page.hasMore);
                              } catch {
                                setHistoryError(
                                  "Earlier messages couldn’t load. Please try again.",
                                );
                              } finally {
                                setLoadingOlder(false);
                              }
                            }}
                          >
                            {loadingOlder
                              ? "Loading…"
                              : "Earlier conversation ↑"}
                          </Button>
                        )}
                        {historyError && (
                          <p
                            role="alert"
                            className="mt-3 text-xs text-destructive"
                          >
                            {historyError}
                          </p>
                        )}
                      </MessageScrollerItem>
                    )}
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
                        <Message
                          align={message.role === "user" ? "end" : "start"}
                        >
                          {message.role === "assistant" && (
                            <MessageAvatar
                              className="size-8 self-start"
                              aria-hidden="true"
                            >
                              {presence}
                            </MessageAvatar>
                          )}
                          <MessageContent>
                            {message.metadata?.socialEvent && (
                              <SocialEvent
                                event={message.metadata.socialEvent}
                                userId={userId}
                              />
                            )}
                            <Bubble
                              variant={
                                message.role === "user" ? "muted" : "ghost"
                              }
                              className={
                                message.role === "user" ? undefined : "w-full"
                              }
                            >
                              <BubbleContent
                                className={
                                  message.role === "user"
                                    ? undefined
                                    : "w-full overflow-visible"
                                }
                              >
                                <span className="sr-only">
                                  {message.role === "user" ? "You" : name}:{" "}
                                </span>
                                {message.parts.map((part, index) => {
                                  if (part.type === "text")
                                    return (
                                      <p
                                        key={index}
                                        dir="auto"
                                        className="whitespace-pre-wrap break-words [&+p]:mt-3"
                                      >
                                        <MentionText
                                          text={part.text}
                                          mentions={
                                            message.metadata?.mentions ?? []
                                          }
                                        />
                                      </p>
                                    );

                                  if (
                                    part.type === "tool-readBalance" &&
                                    "state" in part &&
                                    part.state === "output-available" &&
                                    "output" in part
                                  )
                                    return (
                                      <BalanceResult
                                        key={index}
                                        output={part.output}
                                        activation={activation}
                                      />
                                    );

                                  if (
                                    part.type === "tool-prepareTransfer" &&
                                    "state" in part &&
                                    part.state === "output-available" &&
                                    "output" in part &&
                                    inactive.safeParse(part.output).success
                                  )
                                    return <div key={index}>{activation}</div>;

                                  return null;
                                })}
                              </BubbleContent>
                            </Bubble>
                            {operations
                              .filter(
                                (operation) =>
                                  operation.messageId === message.id,
                              )
                              .map((operation) => (
                                <TransferCard
                                  key={operation._id}
                                  operation={operation}
                                  userId={userId}
                                  onUpdate={onOperationUpdate}
                                  onEditRecipient={(amount) => {
                                    updateDraft(`Send ${amount} XLM to `);
                                    composer.current?.focus();
                                  }}
                                />
                              ))}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                    {(streaming || serverBusy) && (
                      <MessageScrollerItem messageId="reply-status">
                        <Marker render={<output />}>
                          <MarkerContent shimmer>
                            {status === "streaming"
                              ? "Replying…"
                              : `${name} is thinking…`}
                          </MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    )}
                  </>
                )}
              </MessageScrollerContent>
            </div>
          </MessageScrollerViewport>
          <MessageScrollerButton variant="outline" size="sm">
            Latest messages <span aria-hidden="true">↓</span>
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="shrink-0 bg-background pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-5 md:pb-6">
        {(error || snapshot.conversation?.error || interrupted) && (
          <p
            role="alert"
            className="mb-3 text-xs leading-relaxed text-destructive"
          >
            {error
              ? readableError(error)
              : snapshot.conversation?.error ||
                "The reply was interrupted. Your history and any prepared transfer are saved. You can continue the conversation."}
          </p>
        )}
        {syncError && (
          <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
            <p>{syncError}</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void reconcile()}
            >
              Check again
            </Button>
          </div>
        )}
        <MentionComposer
          composer={composer}
          draft={draft}
          mentions={mentions}
          updateDraft={updateDraft}
          friends={social.friends.map((row) => row.person)}
          named={!!social.me}
          name={name}
          hydrated={hydrated}
          busy={streaming || serverBusy}
          submit={() => void submit()}
        />
        <p className="mt-2.5 text-center text-[10px] text-muted-foreground">
          A little company for your money.{" "}
          <span className="whitespace-nowrap">
            Testnet · you approve every transfer.
          </span>
        </p>
      </div>
    </section>
  );
}
