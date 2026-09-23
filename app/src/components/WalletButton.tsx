"use client";

import { shortAddress } from "@stellar-scaffold/app-lib/format";

import { useWallet } from "../hooks/useWallet";
import { Button } from "./ui/button";

export const WalletButton = () => {
  const { address, isPending, balances } = useWallet();

  if (!address) {
    return (
      <Button
        onClick={() =>
          void import("@stellar-scaffold/app-lib/wallet").then(
            ({ connectWallet }) => connectWallet(),
          )
        }
        disabled={isPending}
      >
        {isPending ? "Loading..." : "Connect"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {balances?.xlm?.balance ?? "-"} XLM
      </span>

      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          void import("@stellar-scaffold/app-lib/wallet").then(
            ({ profileModal }) => profileModal(),
          )
        }
      >
        {shortAddress(address)}
      </Button>
    </div>
  );
};
