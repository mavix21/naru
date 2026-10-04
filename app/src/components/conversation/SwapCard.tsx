"use client";

import type { Doc } from "@naru/backend/data-model";

import {
  IconArrowDown,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconFingerprint,
  IconLoader2,
} from "@tabler/icons-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { conversationRequest } from "@/lib/conversation/client";
import { displayAmount } from "@/lib/money";
import { swapReviewSchema, swapTermsSchema } from "@/lib/swaps/shared";

type SwapResponse = { operation?: Doc<"operations">; review?: unknown };

export const swapLabels = {
  awaiting_approval: "Ready to exchange",
  submitting: "Exchanging…",
  confirmed: "Exchanged",
  cancelled: "Cancelled",
  failed: "Swap failed",
} as const;

export function SwapCard({
  operation,
  userId,
  onUpdate,
}: {
  operation: Doc<"operations">;
  userId: string;
  onUpdate?: (operation: Doc<"operations">) => void;
}) {
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [quoteError, setQuoteError] = useState(false);
  const card = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const visible = useRef(false);
  const retryAt = useRef(0);
  const failures = useRef(0);
  const swap = operation.swap;
  const editable = operation.state === "awaiting_approval";
  const expiresAt = swap ? Math.min(swap.expiresAt, swap.deadline * 1000) : 0;
  const expired = now > 0 && now >= expiresAt;

  const checkQuote = useEffectEvent(() => {
    if (!visible.current || document.hidden) return;
    const time = Date.now();
    setNow(time);

    if (
      swap &&
      editable &&
      navigator.onLine &&
      !inFlight.current &&
      time >= expiresAt &&
      time >= retryAt.current
    ) {
      void action("quote");
    }
  });

  useEffect(() => {
    if (!editable) return;

    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      checkQuote();
    });

    if (card.current) observer.observe(card.current);
    const check = () => checkQuote();
    const interval = setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);

    return () => {
      observer.disconnect();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, [editable]);

  async function action(kind: "review" | "quote" | "cancel") {
    if (inFlight.current) return;

    // Check the actual clock, including immediately after a suspended tab wakes.
    if (kind === "review" && Date.now() >= expiresAt) {
      await action("quote");

      return;
    }

    inFlight.current = true;
    setBusy(
      kind === "review"
        ? "Opening passkey…"
        : kind === "quote"
          ? "Updating price…"
          : "Cancelling…",
    );

    if (kind !== "quote") setError(undefined);
    let submissionStarted = false;

    const update = (result: SwapResponse) => {
      if (result.operation) {
        onUpdate?.(result.operation);
        setNow(Date.now());
      }
    };

    const request = (
      action: "review" | "quote" | "cancel" | "authorize",
      extra?: { auth: string; reviewId: string },
    ) =>
      conversationRequest<SwapResponse>(userId, "/api/swaps", {
        action,
        id: operation._id,
        revision: operation.revision,
        ...extra,
      });

    const run = async () => {
      if (kind !== "review") {
        update(await request(kind));

        if (kind === "quote") {
          failures.current = 0;
          setQuoteError(false);
          setError(undefined);
        }
      } else {
        if (!navigator.locks)
          throw new Error("Use a current browser with passkey support.");

        const { NaruSmartAccount } =
          await import("@/lib/smart-account/adapter");

        const account = await NaruSmartAccount.open("/api/payments", userId);
        await account.restore();
        const result = await request("review");

        if (!result.review) {
          update(result);

          return;
        }

        const review = swapReviewSchema.parse(result.review);

        if (review.id !== operation.reviewId)
          throw new Error("This quote changed. Read the updated card.");
        setBusy("Confirm on your device…");

        const auth = await account.signSwap(review, {
          ...operation,
          swap: swapTermsSchema.parse(operation.swap),
        });

        setBusy("Exchanging…");
        submissionStarted = true;
        update(await request("authorize", { reviewId: review.id, auth }));
      }
    };

    try {
      // Share the lock with other cards/tabs, including background refreshes.
      if (navigator.locks) {
        await navigator.locks.request(
          `naru:swap:${operation._id}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await run();
            else if (kind !== "quote")
              throw new Error(
                "This exchange is being updated. Try again shortly.",
              );
          },
        );
      } else await run();
    } catch (cause) {
      if (kind === "quote") {
        failures.current += 1;
        setQuoteError(true);
      } else
        setError(
          submissionStarted
            ? "Couldn’t confirm submission. Check this swap’s status before trying again."
            : cause instanceof Error &&
                /cancel|NotAllowed|denied|timed out/i.test(
                  `${cause.name} ${cause.message}`,
                )
              ? "Passkey not authorized. No new swap was submitted."
              : cause instanceof Error
                ? cause.message
                : "Couldn’t finish. Check this swap’s status.",
        );
    } finally {
      // Back off failed refreshes; also allow the live query to deliver a new revision.
      retryAt.current =
        Date.now() +
        (failures.current
          ? Math.min(60_000, 15_000 * 2 ** (failures.current - 1))
          : 2_000);
      inFlight.current = false;
      setBusy(undefined);

      if (kind === "review")
        void conversationRequest(userId, "/api/transfers").catch(() => {});
    }
  }

  if (!swap) return null;
  const confirmed = operation.state === "confirmed";
  const received = confirmed ? operation.receivedUnits : swap.expectedOut;
  const rate = Number(swap.expectedOut) / Number(operation.units);

  return (
    <article
      ref={card}
      aria-label="Swap XLM for USDC"
      className="my-4 w-full max-w-sm rounded-3xl border border-border/70 bg-card p-4 shadow-xs sm:p-5"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Exchange</h3>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          Testnet
        </span>
      </header>
      <div className="relative grid gap-1.5">
        {[
          {
            label: confirmed ? "You paid" : "You pay",
            amount: operation.amount,
            asset: "XLM",
          },
          {
            label: confirmed ? "You received" : "You receive ≈",
            amount: received ? displayAmount(received) : "—",
            asset: "USDC",
          },
        ].map(({ label, amount, asset }) => (
          <div key={asset} className="rounded-2xl bg-muted/60 px-4 py-4">
            <p className="mb-2 text-xs text-muted-foreground">{label}</p>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-all text-[clamp(1.25rem,5vw,1.875rem)] leading-tight tracking-[-.04em] tabular-nums">
                {amount}
              </p>
              <span className="flex shrink-0 items-center gap-2 rounded-full bg-card px-2.5 py-1.5 text-xs font-medium shadow-xs">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${asset === "XLM" ? "bg-foreground" : "bg-[#2775ca]"}`}
                />
                {asset}
              </span>
            </div>
          </div>
        ))}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border-4 border-card bg-muted text-muted-foreground"
        >
          <IconArrowDown className="size-3.5" />
        </span>
      </div>

      <details className="group mt-3 text-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>
            1 XLM ≈ {rate.toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
            USDC
          </span>
          <span className="flex shrink-0 items-center gap-1">
            Details{" "}
            <IconChevronDown
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-180"
            />
          </span>
        </summary>
        <dl className="space-y-2.5 border-t border-border/60 pt-3 pb-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Minimum receive</dt>
            <dd className="tabular-nums">
              {displayAmount(swap.minimumOut)} USDC
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Exchange fee</dt>
            <dd>0.3% included</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Network fee</dt>
            <dd>Paid by Naru</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Slippage limit</dt>
            <dd>{swap.slippageBps / 100}%</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Provider</dt>
            <dd>Soroswap</dd>
          </div>
          {swap.targetOut && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Receive target</dt>
              <dd>{displayAmount(swap.targetOut)} USDC</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Receive in</dt>
            <dd title={operation.account}>
              Naru · {operation.account.slice(0, 4)}…
              {operation.account.slice(-4)}
            </dd>
          </div>
        </dl>
        {editable && (
          <p className="pt-1 pb-2 text-muted-foreground">
            Prices refresh automatically.
          </p>
        )}
      </details>
      {(error || operation.error) && (
        <p
          role="alert"
          className="mt-3 text-xs leading-relaxed text-destructive"
        >
          {error || operation.error}
        </p>
      )}
      {editable ? (
        <div className="mt-3 space-y-1">
          {quoteError && expired && (
            <output className="mb-3 block text-center text-xs text-muted-foreground">
              Price unavailable. Retrying automatically…
            </output>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={!!busy || !now || (expired && !quoteError)}
            onClick={() => void action(expired ? "quote" : "review")}
          >
            {busy || (expired && !quoteError) ? (
              <IconLoader2
                aria-hidden="true"
                className="size-4 motion-safe:animate-spin"
              />
            ) : (
              <IconFingerprint aria-hidden="true" className="size-4" />
            )}
            {busy ||
              (expired
                ? quoteError
                  ? "Retry price"
                  : "Updating price…"
                : "Confirm exchange")}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => void action("cancel")}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <output
          aria-live="polite"
          className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-muted/60 py-3 text-sm"
        >
          {confirmed && <IconCheck aria-hidden="true" className="size-4" />}
          {operation.state === "submitting" && (
            <IconLoader2
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
          )}
          {swapLabels[operation.state]}
        </output>
      )}
      {operation.hash && (
        <a
          className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          href={`https://stellar.expert/explorer/testnet/tx/${operation.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          {confirmed ? "View receipt" : "View transaction"}
          <IconArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      )}
    </article>
  );
}
