"use client";

import {
  IconArrowLeft,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconWallet,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmount, TESTNET_ASSETS } from "@/lib/money";
import {
  shortAddress,
  TIP,
  tipReviewSchema,
  tipStatusSchema,
  trustlineSchema,
  type TipReview,
  type TipStatus,
} from "@/lib/tips/shared";
import { cn } from "@/lib/utils";

import { kitError, walletError, walletKit } from "./wallet-kit";

type Step =
  | { kind: "amount" }
  | { kind: "preparing" }
  | { kind: "trustline"; sender: string; adding: boolean }
  | { kind: "review"; review: TipReview }
  | { kind: "signing"; review: TipReview }
  | { kind: "status"; status: TipStatus };

const TESTNET_USDC_ISSUER = TESTNET_ASSETS.usdcIssuer;

const explorer = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

type TipRequest =
  | { action: "prepare"; username: string; sender: string; amount: string }
  | { action: "submit"; checkout: string; xdr: string }
  | { action: "trustline"; sender: string }
  | { action: "trust"; sender: string; xdr: string };

const failure = z.object({ error: z.string(), reason: z.string().optional() });

class TipRequestError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

async function tipRequest(body?: TipRequest, checkout?: string) {
  const response = await fetch(
    checkout
      ? `/api/tips?checkout=${encodeURIComponent(checkout)}`
      : "/api/tips",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = failure.safeParse(json).data;

    throw new TipRequestError(
      parsed?.error ?? "Couldn’t reach Naru. Nothing was sent.",
      parsed?.reason,
    );
  }

  return json;
}

function validAmount(value: string) {
  try {
    const { units } = parseAmount(value, "USDC");

    return (
      BigInt(units) >= BigInt(parseAmount(TIP.minimum, "USDC").units) &&
      BigInt(units) <= BigInt(parseAmount(TIP.maximum, "USDC").units)
    );
  } catch {
    return false;
  }
}

export function TipCheckout({
  username,
  displayName,
}: {
  username: string;
  displayName: string;
}) {
  const storageKey = `naru:tip:${username}`;
  const [amount, setAmount] = useState<string>(TIP.presets[1]);
  const [custom, setCustom] = useState(false);
  const [address, setAddress] = useState<string>();
  const [step, setStep] = useState<Step>({ kind: "amount" });
  const amountId = useId();
  const [notice, setNotice] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const stepRef = useRef<Step>(step);

  // Async wallet callbacks read the latest step without waiting for a render.
  const go = useCallback((next: Step) => {
    stepRef.current = next;
    setStep(next);
  }, []);

  const remember = useCallback(
    (checkout?: string) => {
      try {
        if (checkout) localStorage.setItem(storageKey, checkout);
        else localStorage.removeItem(storageKey);
      } catch {
        // Recovery is a convenience; the server record remains authoritative.
      }
    },
    [storageKey],
  );

  // Any change to the bound account, network, amount or recipient voids the review.
  const invalidate = useCallback(
    (message: string) => {
      const current = stepRef.current;

      if (
        current.kind === "review" ||
        current.kind === "signing" ||
        current.kind === "trustline"
      ) {
        go({ kind: "amount" });
        setNotice(message);
      }
    },
    [go],
  );

  // Restore the connected wallet and any unfinished tip after a reload.
  useEffect(() => {
    let active = true;
    const subscriptions: (() => void)[] = [];

    void walletKit()
      .then(async (kit) => {
        if (!active) return;

        try {
          const { address } = await kit.getAddress();

          if (active) setAddress(address);
        } catch {
          // No wallet connected yet.
        }

        const { KitEventType } =
          await import("@creit-tech/stellar-wallets-kit/types");

        subscriptions.push(
          kit.on(KitEventType.STATE_UPDATED, (event) => {
            setAddress(event.payload.address);

            const current = stepRef.current;

            const bound =
              current.kind === "trustline"
                ? current.sender
                : current.kind === "review" || current.kind === "signing"
                  ? current.review.sender
                  : undefined;

            if (bound && event.payload.address !== bound)
              invalidate(
                "Your wallet account changed, so the review was cleared. Review the tip again.",
              );
          }),
          kit.on(KitEventType.DISCONNECT, () => {
            setAddress(undefined);
            invalidate("Wallet disconnected. Reconnect to review your tip.");
          }),
        );
      })
      .catch(() => {
        if (active)
          setNotice(
            "Wallet connection couldn’t load in this browser. Refresh to try again.",
          );
      });

    let saved: string | null = null;

    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      saved = null;
    }

    if (saved)
      void tipRequest(undefined, saved)
        .then((json) => {
          const status = tipStatusSchema.parse(json);

          if (!active) return;

          // An unsigned review can't be resumed safely; start fresh.
          if (status.state === "review" || status.state === "failed")
            remember();
          else go({ kind: "status", status });
        })
        .catch(() => remember());

    return () => {
      active = false;

      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [go, invalidate, remember, storageKey]);

  // Poll a submitted tip until the server independently verifies the outcome.
  const pendingCheckout =
    step.kind === "status" && step.status.state === "pending"
      ? step.status.checkout
      : undefined;

  useEffect(() => {
    if (!pendingCheckout) return;

    const timer = setInterval(async () => {
      try {
        const status = tipStatusSchema.parse(
          await tipRequest(undefined, pendingCheckout),
        );

        go({ kind: "status", status });
      } catch {
        // Keep showing pending; never create another payment automatically.
      }
    }, 4_000);

    return () => clearInterval(timer);
  }, [go, pendingCheckout]);

  // Expire the review exactly when the server would refuse it.
  const reviewExpiry =
    step.kind === "review" ? step.review.expiresAt : undefined;

  useEffect(() => {
    if (!reviewExpiry) return;

    const timer = setTimeout(
      () => invalidate("That review expired. Review the tip again."),
      Math.max(0, reviewExpiry - Date.now()),
    );

    return () => clearTimeout(timer);
  }, [invalidate, reviewExpiry]);

  async function connect() {
    setNotice(undefined);
    setConnecting(true);

    try {
      const kit = await walletKit();
      const { address } = await kit.authModal();
      setAddress(address);

      return address;
    } catch (error) {
      setNotice(
        walletError(kitError.parse(error), "Couldn’t connect that wallet."),
      );
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    const kit = await walletKit();
    await kit.disconnect();
    setAddress(undefined);
    go({ kind: "amount" });
  }

  // Wallets that report their network must be on Testnet before we prepare.
  async function walletNetwork() {
    const kit = await walletKit();

    try {
      return (await kit.getNetwork()).networkPassphrase;
    } catch {
      return null;
    }
  }

  async function prepareReview() {
    setNotice(undefined);

    if (!validAmount(amount))
      return setNotice(
        `Choose an amount between ${TIP.minimum} and ${TIP.maximum} USDC.`,
      );

    const sender = address ?? (await connect());

    if (!sender) return;

    const network = await walletNetwork();

    if (network && network !== TIP.networkPassphrase)
      return setNotice(
        "Your wallet is on a different network. Switch it to Stellar Testnet, then review again.",
      );

    go({ kind: "preparing" });

    try {
      const review = tipReviewSchema.parse(
        await tipRequest({ action: "prepare", username, sender, amount }),
      );

      if (
        review.sender !== sender ||
        review.amount !== parseAmount(amount, "USDC").amount ||
        review.recipient.username !== username
      )
        throw new Error("The prepared tip didn’t match your choices.");

      go({ kind: "review", review });
    } catch (error) {
      if (error instanceof TipRequestError && error.reason === "usdc_trustline")
        return go({ kind: "trustline", sender, adding: false });

      go({ kind: "amount" });
      setNotice(
        error instanceof Error ? error.message : "Couldn’t prepare this tip.",
      );
    }
  }

  // One-time wallet setup, signed like any transaction so every wallet can do it.
  async function addUsdc(sender: string) {
    setNotice(undefined);
    go({ kind: "trustline", sender, adding: true });

    try {
      const kit = await walletKit();

      const [{ address: current }, network] = await Promise.all([
        kit.getAddress(),
        walletNetwork(),
      ]);

      if (current !== sender)
        return invalidate("Your wallet account changed. Review the tip again.");

      if (network && network !== TIP.networkPassphrase)
        throw new Error(
          "Your wallet is on a different network. Switch it to Stellar Testnet, then try again.",
        );

      let result = trustlineSchema.parse(
        await tipRequest({ action: "trustline", sender }),
      );

      if (result.state === "sign") {
        const { signedTxXdr } = await kit.signTransaction(result.xdr, {
          address: sender,
          networkPassphrase: result.networkPassphrase,
        });

        if (stepRef.current.kind !== "trustline") return;

        result = trustlineSchema.parse(
          await tipRequest({ action: "trust", sender, xdr: signedTxXdr }),
        );
      }

      if (result.state === "pending")
        throw new Error(
          "USDC is still being added on Stellar Testnet. Try again in a few seconds.",
        );

      // Trustline ready: continue straight to the tip review.
      await prepareReview();
    } catch (error) {
      if (stepRef.current.kind !== "trustline") return;

      go({ kind: "trustline", sender, adding: false });
      setNotice(
        error instanceof Error
          ? error.message
          : walletError(kitError.parse(error), "The wallet couldn’t add USDC."),
      );
    }
  }

  async function sign(review: TipReview) {
    setNotice(undefined);

    if (review.expiresAt <= Date.now())
      return invalidate("That review expired. Review the tip again.");

    go({ kind: "signing", review });
    const kit = await walletKit();

    try {
      const [{ address: current }, network] = await Promise.all([
        kit.getAddress(),
        walletNetwork(),
      ]);

      if (current !== review.sender)
        return invalidate(
          "Your wallet account changed, so the review was cleared. Review the tip again.",
        );

      if (network && network !== review.networkPassphrase)
        return invalidate(
          "Your wallet switched networks. Switch back to Stellar Testnet and review again.",
        );

      const { signedTxXdr } = await kit.signTransaction(review.xdr, {
        address: review.sender,
        networkPassphrase: review.networkPassphrase,
      });

      if (stepRef.current.kind !== "signing") return;

      remember(review.checkout);

      const status = tipStatusSchema.parse(
        await tipRequest({
          action: "submit",
          checkout: review.checkout,
          xdr: signedTxXdr,
        }),
      );

      go({ kind: "status", status });
    } catch (error) {
      if (stepRef.current.kind !== "signing") return;

      // A rejected or mismatched signature leaves the unsigned review intact.
      go({ kind: "review", review });
      setNotice(
        error instanceof Error && !("code" in error)
          ? error.message
          : walletError(
              kitError.parse(error),
              "The wallet couldn’t sign this tip.",
            ),
      );
    }
  }

  function startOver() {
    remember();
    setNotice(undefined);
    go({ kind: "amount" });
  }

  return (
    <section
      aria-labelledby="tip-heading"
      className="rounded-3xl border bg-card p-5 md:p-6"
    >
      {step.kind === "status" ? (
        <TipResult
          status={step.status}
          displayName={displayName}
          onDone={startOver}
        />
      ) : step.kind === "trustline" ? (
        <TrustlineStep
          sender={step.sender}
          adding={step.adding}
          notice={notice}
          onBack={() => {
            setNotice(undefined);
            go({ kind: "amount" });
          }}
          onAdd={() => addUsdc(step.sender)}
        />
      ) : step.kind === "review" || step.kind === "signing" ? (
        <TipSummary
          review={step.review}
          signing={step.kind === "signing"}
          notice={notice}
          onBack={() => {
            setNotice(undefined);
            go({ kind: "amount" });
          }}
          onSign={() => sign(step.review)}
        />
      ) : (
        <>
          <h2 id="tip-heading" className="text-base font-medium">
            Send {displayName} a tip
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            In USDC on Stellar Testnet, straight to their Naru account.
          </p>
          <fieldset className="mt-5">
            <legend className="sr-only">Tip amount in USDC</legend>
            <div className="grid grid-cols-4 gap-2">
              {TIP.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={!custom && amount === preset}
                  onClick={() => {
                    setCustom(false);
                    setAmount(preset);
                    setNotice(undefined);
                  }}
                  className={cn(
                    "h-11 rounded-2xl border text-sm font-medium tabular-nums transition-colors outline-ring hover:bg-muted focus-visible:outline-2",
                    !custom &&
                      amount === preset &&
                      "border-primary bg-primary/10 text-primary hover:bg-primary/10",
                  )}
                >
                  ${preset}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <Input
                id={amountId}
                size="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Other amount"
                aria-label="Custom tip amount in USDC"
                value={custom ? amount : ""}
                onFocus={() => {
                  if (!custom) {
                    setCustom(true);
                    setAmount("");
                  }
                }}
                onChange={(event) => {
                  setCustom(true);
                  setAmount(event.target.value.trim());
                  setNotice(undefined);
                }}
              />
              <label
                htmlFor={amountId}
                className="absolute inset-y-0 right-4 flex items-center text-xs text-muted-foreground"
              >
                USDC
              </label>
            </div>
          </fieldset>
          {notice && (
            <p role="alert" className="mt-3 text-xs leading-5 text-destructive">
              {notice}
            </p>
          )}
          <Button
            type="button"
            size="lg"
            className="mt-4 h-11 w-full"
            disabled={step.kind === "preparing" || connecting}
            onClick={prepareReview}
          >
            {step.kind === "preparing" ? (
              <>
                <IconLoader2 className="animate-spin" /> Preparing review…
              </>
            ) : connecting ? (
              <>
                <IconLoader2 className="animate-spin" /> Connecting…
              </>
            ) : address ? (
              `Review ${validAmount(amount) ? `${parseAmount(amount, "USDC").amount} USDC ` : ""}tip`
            ) : (
              <>
                <IconWallet /> Connect wallet to tip
              </>
            )}
          </Button>
          {address ? (
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                Paying from{" "}
                <span className="font-mono text-foreground">
                  {shortAddress(address)}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={connect}
                >
                  Switch
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              </span>
            </div>
          ) : (
            <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
              No Naru account needed. Connecting a wallet doesn’t sign you in.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function TrustlineStep({
  sender,
  adding,
  notice,
  onBack,
  onAdd,
}: {
  sender: string;
  adding: boolean;
  notice?: string;
  onBack: () => void;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Back to amount"
          disabled={adding}
          onClick={onBack}
        >
          <IconArrowLeft />
        </Button>
        <h2 id="tip-heading" className="text-base font-medium">
          Add USDC to your wallet
        </h2>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        One-time setup: before{" "}
        <span className="font-mono text-foreground">
          {shortAddress(sender)}
        </span>{" "}
        can hold or send USDC, it needs to trust Testnet USDC. Your wallet will
        ask you to approve it.
      </p>
      <dl className="mt-3 divide-y text-xs">
        <Row label="Asset">
          USDC{" "}
          <span className="text-muted-foreground">
            · {shortAddress(TESTNET_USDC_ISSUER)}
          </span>
        </Row>
        <Row label="Reserved">0.5 XLM (refundable)</Row>
        <Row label="Network fee">under 0.01 XLM</Row>
      </dl>
      {notice && (
        <p role="alert" className="mt-3 text-xs leading-5 text-destructive">
          {notice}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        className="mt-4 h-11 w-full"
        disabled={adding}
        onClick={onAdd}
      >
        {adding ? (
          <>
            <IconLoader2 className="animate-spin" /> Approve in your wallet…
          </>
        ) : (
          "Add USDC in wallet"
        )}
      </Button>
      <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
        No funds move. Your tip review continues right after.
      </p>
    </>
  );
}

function TipSummary({
  review,
  signing,
  notice,
  onBack,
  onSign,
}: {
  review: TipReview;
  signing: boolean;
  notice?: string;
  onBack: () => void;
  onSign: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);

    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((review.expiresAt - now) / 1000));

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Edit tip"
          disabled={signing}
          onClick={onBack}
        >
          <IconArrowLeft />
        </Button>
        <h2 id="tip-heading" className="text-base font-medium">
          Review your tip
        </h2>
      </div>
      <p className="mt-4 text-center text-4xl font-medium tracking-tight tabular-nums">
        {review.amount}
        <span className="ml-1.5 text-base text-muted-foreground">USDC</span>
      </p>
      <dl className="mt-4 divide-y text-xs">
        <Row label="To">
          <span className="block font-medium">
            {review.recipient.displayName}
          </span>
          <span className="block text-muted-foreground">
            @{review.recipient.username} ·{" "}
            <span className="font-mono" title={review.recipient.account}>
              {shortAddress(review.recipient.account)}
            </span>
          </span>
        </Row>
        <Row label="From">
          <span className="font-mono" title={review.sender}>
            {shortAddress(review.sender)}
          </span>
        </Row>
        <Row label="Network">{review.network}</Row>
        <Row label="Asset">
          USDC{" "}
          <span className="text-muted-foreground">
            · {shortAddress(review.issuer)}
          </span>
        </Row>
        <Row label="Network fee">
          up to {review.fee} XLM
          <span className="block text-muted-foreground">
            paid by your wallet
          </span>
        </Row>
      </dl>
      {notice && (
        <p role="alert" className="mt-3 text-xs leading-5 text-destructive">
          {notice}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        className="mt-4 h-11 w-full"
        disabled={signing || seconds === 0}
        onClick={onSign}
      >
        {signing ? (
          <>
            <IconLoader2 className="animate-spin" /> Confirm in your wallet…
          </>
        ) : (
          `Sign & send ${review.amount} USDC`
        )}
      </Button>
      <p className="mt-3 text-center text-[11px] text-muted-foreground tabular-nums">
        Review valid for {Math.floor(seconds / 60)}:
        {String(seconds % 60).padStart(2, "0")} · Your wallet will show the same
        transfer.
      </p>
    </>
  );
}

function TipResult({
  status,
  displayName,
  onDone,
}: {
  status: TipStatus;
  displayName: string;
  onDone: () => void;
}) {
  if (status.state === "confirmed")
    return (
      <div className="text-center" aria-live="polite">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
          <IconCheck className="size-6" />
        </span>
        <h2 id="tip-heading" className="mt-4 text-lg font-medium">
          Thanks for tipping {displayName}!
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Confirmed on Stellar Testnet
          {status.ledger ? ` · ledger ${status.ledger}` : ""}
        </p>
        <p className="mt-5 text-4xl font-medium tracking-tight tabular-nums">
          {status.amount}
          <span className="ml-1.5 text-base text-muted-foreground">USDC</span>
        </p>
        <dl className="mt-4 divide-y text-left text-xs">
          <Row label="From">
            <span className="font-mono">{shortAddress(status.sender)}</span>
          </Row>
          <Row label="Network fee">up to {status.fee} XLM</Row>
        </dl>
        <a
          href={explorer(status.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs underline underline-offset-4"
        >
          View receipt <IconExternalLink className="size-3" />
        </a>
        <Button
          type="button"
          variant="outline"
          className="mt-5 h-10 w-full"
          onClick={onDone}
        >
          Send another tip
        </Button>
      </div>
    );

  if (status.state === "pending")
    return (
      <div className="py-4 text-center" aria-live="polite">
        <IconLoader2 className="mx-auto size-10 animate-spin text-primary" />
        <h2 id="tip-heading" className="mt-4 text-base font-medium">
          Sending {status.amount} USDC…
        </h2>
        <p className="mx-auto mt-2 max-w-64 text-xs leading-5 text-muted-foreground">
          {status.error ??
            "Waiting for Stellar Testnet to confirm. You can leave this page — we’ll pick it back up."}
        </p>
        <a
          href={explorer(status.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground underline underline-offset-4"
        >
          {status.hash.slice(0, 10)}…{status.hash.slice(-6)}
          <IconExternalLink className="size-3" />
        </a>
      </div>
    );

  return (
    <div className="text-center" aria-live="polite">
      <h2 id="tip-heading" className="text-base font-medium">
        Tip not sent
      </h2>
      <p role="alert" className="mt-2 text-xs leading-5 text-destructive">
        {status.error ?? "This tip didn’t go through."}
      </p>
      <Button type="button" className="mt-5 h-10 w-full" onClick={onDone}>
        Start a new tip
      </Button>
    </div>
  );
}
