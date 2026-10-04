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
import { Card, CardContent, CardTitle } from "@/components/ui/card";
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
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useMessageDraft } from "@/hooks/useMessageDraft";
import { conversationRequest } from "@/lib/conversation/client";
import { mentionMetadata, type Mention } from "@/lib/mentions";
import { displayAmount } from "@/lib/money";

import { SwapCard } from "./SwapCard";
import { FundingResult, TestFunding } from "./TestFunding";
import { TransferCard } from "./TransferCard";
import { WalletAddress } from "./WalletAddress";
import { WalletBalances } from "./WalletBalances";

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
  amount: z.string().nullable(),
  address: z.string().optional(),
  balanceError: z.string().nullable().optional(),
  asset: z.literal("XLM"),
  observedAt: z.iso.datetime(),
  usdcAmount: z.string().nullable().optional(),
  usdcError: z.string().nullable().optional(),
});

function BalanceResult({
  output,
  activation,
  userId,
}: {
  output: unknown;
  activation: ReactNode;
  userId: string;
}) {
  if (inactive.safeParse(output).success) return activation;
  const result = balance.safeParse(output);

  if (!result.success) return null;

  return <BalanceCard initial={result.data} userId={userId} />;
}

function BalanceCard({
  initial,
  userId,
}: {
  initial: z.infer<typeof balance>;
  userId: string;
}) {
  const query = useAccountStatus(userId);
  const current = query.data;

  // A newly delivered balance can be newer than the shared browser cache.
  // Keep that snapshot visible while the mounted query refreshes the wallet.
  const value =
    current?.state === "ready" &&
    current.account &&
    (!initial.address || current.account === initial.address) &&
    query.dataUpdatedAt >= Date.parse(initial.observedAt)
      ? {
          ...initial,
          address: current.account,
          amount:
            current.balance === null ? null : displayAmount(current.balance),
          balanceError: current.balanceError,
          usdcAmount:
            current.usdcBalance == null
              ? null
              : displayAmount(current.usdcBalance),
          usdcError: current.usdcBalanceError,
        }
      : initial;

  return (
    <Card size="sm" className="my-3 w-full max-w-sm">
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Balance</CardTitle>
          <Badge variant="secondary">
            <span className="sr-only">Stellar </span>Testnet
          </Badge>
        </div>
        {value.address && <WalletAddress address={value.address} />}
        <WalletBalances
          xlm={value.amount}
          usdc={value.usdcAmount ?? null}
          xlmError={value.balanceError}
          usdcError={value.usdcError}
        />
        <TestFunding userId={userId} />
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
      records.map((row): ConversationMessage => ({
        ...row.message,
        metadata: { mentions: row.mentions ?? [], socialEvent: row.event },
      })),
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
      ? "Last operation confirmed."
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
                        onClick={() =>
                          void submit("Add free test XLM to my wallet.")
                        }
                      >
                        Get free test XLM <span aria-hidden="true">↗</span>
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
                                        userId={userId}
                                      />
                                    );

                                  if (
                                    part.type === "tool-fundWallet" &&
                                    "state" in part &&
                                    part.state === "output-available" &&
                                    "output" in part
                                  )
                                    return (
                                      <FundingResult
                                        key={index}
                                        output={part.output}
                                        userId={userId}
                                        activation={activation}
                                      />
                                    );

                                  if (
                                    (part.type === "tool-prepareTransfer" ||
                                      part.type === "tool-prepareSwap") &&
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
                              .map((operation) =>
                                operation.swap ? (
                                  <SwapCard
                                    key={operation._id}
                                    operation={operation}
                                    userId={userId}
                                    onUpdate={onOperationUpdate}
                                  />
                                ) : (
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
                                ),
                              )}
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
            Practice money · you approve every payment.
          </span>
        </p>
      </div>
    </section>
  );
}
