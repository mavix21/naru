"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NaruSmartAccount,
  smartAccountError,
} from "@/lib/smart-account/adapter";
import {
  formatBalance,
  type AccountStatus,
  type TransferReview,
} from "@/lib/smart-account/shared";

export default function ValidationScreen() {
  const [adapter, setAdapter] = useState<NaruSmartAccount | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [review, setReview] = useState<TransferReview | null>(null);
  const [busy, setBusy] = useState("Checking testnet configuration…");
  const [error, setError] = useState("");

  const refresh = useCallback(async (client: NaruSmartAccount) => {
    setAddress((await client.metadata())?.contractId || null);
    setStatus(await client.status());
  }, []);

  useEffect(() => {
    let active = true;
    void NaruSmartAccount.open()
      .then(async (client) => {
        if (!active) return;
        setAdapter(client);
        await refresh(client);
      })
      .catch((cause: Error) => {
        if (active) setError(smartAccountError(cause));
      })
      .finally(() => {
        if (active) setBusy("");
      });

    return () => {
      active = false;
    };
  }, [refresh]);

  const pending =
    status?.jobs.some(
      (job) => job.state === "pending" || job.state === "preparing",
    ) || false;

  useEffect(() => {
    if (!adapter || !pending || busy) return;

    const timer = setInterval(() => {
      void refresh(adapter).catch((cause: Error) =>
        setError(smartAccountError(cause)),
      );
    }, 5000);

    return () => clearInterval(timer);
  }, [adapter, pending, busy, refresh]);

  async function run(
    label: string,
    operation: (client: NaruSmartAccount) => Promise<void>,
  ) {
    if (!adapter || busy) return;
    setBusy(label);
    setError("");

    try {
      await operation(adapter);
    } catch (cause) {
      setError(
        cause instanceof Error ? smartAccountError(cause) : "Operation failed.",
      );
    } finally {
      try {
        await refresh(adapter);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not refresh chain status.",
        );
      }

      setBusy("");
    }
  }

  const disabled = Boolean(busy) || !adapter;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="space-y-3">
        <Badge variant="secondary">Slice 1 · Stellar testnet only</Badge>
        <h1 className="text-2xl font-semibold">Smart-account validation</h1>
        <p className="text-muted-foreground">
          Technical validation with passkeys and backend-sponsored fees. Test
          XLM has no monetary value.
        </p>
      </div>
      <output aria-live="polite">
        {busy ||
          (connected
            ? "Passkey access restored for this session."
            : "Access locked. Restore with the saved passkey.")}
      </output>
      {error && (
        <p role="alert" className="wrap-break-word text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>1. Create or restore</CardTitle>
          <CardDescription>
            Only public credential metadata and deployment references are stored
            in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p>
              Status:{" "}
              {status?.deployed
                ? "Deployed on testnet"
                : address
                  ? "Credential saved; deployment unconfirmed"
                  : "No local account"}
            </p>
            {address && (
              <p className="break-all font-mono text-xs">{address}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {!address && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      "Create a passkey in the native prompt…",
                      async (client) => {
                        await client.create();
                      },
                    )
                  }
                >
                  Create passkey & account
                </Button>
              )}
              {address && !status?.deployed && (
                <Button
                  disabled={disabled || pending}
                  onClick={() =>
                    void run(
                      "Resuming the same deployment…",
                      async (client) => {
                        await client.resumeDeployment();
                      },
                    )
                  }
                >
                  Resume deployment
                </Button>
              )}
              {address && (
                <Button
                  disabled={disabled || !status?.deployed}
                  onClick={() =>
                    void run(
                      "Select the saved Naru passkey…",
                      async (client) => {
                        setConnected(false);
                        await client.restore();
                        setConnected(true);
                      },
                    )
                  }
                >
                  Restore with passkey
                </Button>
              )}
              <Button
                variant="outline"
                disabled={disabled || !address}
                onClick={() =>
                  void run("Checking chain status…", async () => {})
                }
              >
                Refresh status
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Reload this page, then restore to verify the same address.
              Cross-device recovery and discovery are not enabled. A synced
              passkey alone does not replace this browser’s account metadata.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>2. Test-asset balance</CardTitle>
          <CardDescription>
            Native testnet XLM, held through the Stellar Asset Contract.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-xl">
              {status?.balance === null || !status
                ? "—"
                : formatBalance(status.balance)}{" "}
              test XLM
            </p>
            <Button
              disabled={
                disabled ||
                !connected ||
                pending ||
                status?.jobs.some(
                  (job) => job.kind === "fund" && job.state === "confirmed",
                )
              }
              onClick={() =>
                void run("Sending test funding…", async (client) => {
                  await client.fund();
                })
              }
            >
              Fund with 5 test XLM
            </Button>
            <p className="text-sm text-muted-foreground">
              One funding grant per account, from the backend’s Friendbot-funded
              testnet account. No real funds.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>3. Review and authorize</CardTitle>
          <CardDescription>
            The passkey signs the exact transfer. The backend supplies the
            transaction source and pays network fees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Button
              disabled={disabled || !connected || pending}
              onClick={() =>
                void run("Preparing a transfer for review…", async (client) => {
                  setReview(await client.review());
                })
              }
            >
              Review 0.1 test XLM transfer
            </Button>
            {review && (
              <div className="space-y-3">
                <p>
                  Send <strong>{review.amount} test XLM</strong> on{" "}
                  <strong>Stellar testnet</strong>.
                </p>
                <p className="break-all text-sm">From: {review.account}</p>
                <p className="break-all text-sm">To: {review.recipient}</p>
                <p className="break-all text-xs">
                  Asset contract: {review.token}
                </p>
                <p className="text-sm">
                  Network fee paid by Naru’s test sponsor. Review expires in 2
                  minutes.
                </p>
                <div className="flex gap-3">
                  <Button
                    disabled={disabled || pending}
                    onClick={() =>
                      void run(
                        "Authorize this transfer in the native passkey prompt…",
                        async (client) => {
                          await client.authorize(review);
                          setReview(null);
                        },
                      )
                    }
                  >
                    Authorize & send with passkey
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setReview(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Transaction evidence</CardTitle>
          <CardDescription>
            “Confirmed” means RPC returned SUCCESS with an inclusion ledger.
            Pending and unknown submissions are not confirmations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!status?.jobs.length && <p>No transactions yet.</p>}
            {status?.jobs.map(
              (job) =>
                job.state !== "review" && (
                  <div key={job.id} className="space-y-1 border-b pb-3">
                    <p>
                      {job.kind} · <strong>{job.state}</strong>
                      {job.ledger ? ` · ledger ${job.ledger}` : ""}
                    </p>
                    {job.hash && (
                      <a
                        className="block break-all text-xs underline"
                        href={`https://stellar.expert/explorer/testnet/tx/${job.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {job.hash}
                      </a>
                    )}
                    {job.error && (
                      <p className="wrap-break-word text-sm text-destructive">
                        {job.error}
                      </p>
                    )}
                    {job.state === "pending" && (
                      <p className="text-sm">
                        Awaiting chain confirmation. Refresh to check; do not
                        create another payment.
                      </p>
                    )}
                  </div>
                ),
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
