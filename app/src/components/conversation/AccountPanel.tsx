"use client";

import { api } from "@naru/backend/api";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { displayAmount } from "@/lib/money";

import { TestFunding } from "./TestFunding";
import { WalletAddress } from "./WalletAddress";
import { WalletBalances } from "./WalletBalances";

export function AccountPanel({
  userId,
  preloaded,
}: {
  userId: string;
  preloaded: Preloaded<typeof api.payments.current>;
}) {
  const payment = usePreloadedQuery(preloaded);
  const query = useAccountStatus(userId);

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Your wallet</h2>
        <Badge variant="secondary">Testnet</Badge>
      </div>
      {payment?.state === "ready" && payment.account ? (
        <>
          <WalletAddress address={payment.account} />
          <WalletBalances
            xlm={
              payment.balance !== null ? displayAmount(payment.balance) : null
            }
            usdc={
              payment.usdcBalance != null
                ? displayAmount(payment.usdcBalance)
                : null
            }
            xlmError={payment.balanceError}
            usdcError={payment.usdcBalanceError}
          />
          <TestFunding userId={userId} />
        </>
      ) : (
        <div className="mt-4">
          <Button
            size="sm"
            render={<Link href="/activate" />}
            nativeButton={false}
          >
            {payment ? "Continue setup" : "Set up wallet"} ↗
          </Button>
        </div>
      )}
      {query.error && payment?.state !== "ready" && (
        <details className="mt-3 text-xs text-destructive">
          <summary className="cursor-pointer">Wallet unavailable</summary>
          <p className="mt-1 leading-relaxed">{query.error.message}</p>
        </details>
      )}
    </div>
  );
}
