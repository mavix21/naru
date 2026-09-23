"use client";

import { networkStatus } from "@stellar-scaffold/app-lib/format";
import React from "react";

import { useWallet } from "../hooks/useWallet";
import { Badge } from "./ui/badge";

const NetworkPill: React.FC = () => {
  const { networkPassphrase, address } = useWallet();

  const { appNetwork, state, title } = networkStatus(
    address,
    networkPassphrase,
  );

  return (
    <Badge
      variant={state === "mismatch" ? "destructive" : "secondary"}
      title={title}
    >
      {appNetwork}
      {state === "mismatch" || state === "unverified" ? ` (${state})` : ""}
    </Badge>
  );
};

export default NetworkPill;
