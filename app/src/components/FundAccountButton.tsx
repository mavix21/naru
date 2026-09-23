"use client";

import { fundAccount } from "@stellar-scaffold/app-lib/friendbot";
import React, { useTransition } from "react";

import { useNotification } from "../hooks/useNotification";
import { useWallet } from "../hooks/useWallet";
import { Button } from "./ui/button";

const FundAccountButton: React.FC = () => {
  const { addNotification } = useNotification();
  const [isPending, startTransition] = useTransition();
  const { address, updateBalances } = useWallet();

  if (!address) return null;

  const handleFundAccount = () => {
    startTransition(async () => {
      const { ok, message } = await fundAccount(address);
      if (ok) await updateBalances();
      addNotification(message, ok ? "success" : "error");
    });
  };

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={handleFundAccount}
      title="Fund your account with test XLM via Friendbot"
    >
      Fund Account
    </Button>
  );
};

export default FundAccountButton;
