"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function WalletAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="-ml-2.5"
        aria-label={`Copy wallet address ${address}`}
        title={address}
        onClick={async () => {
          setCopyFailed(false);

          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
          } catch {
            setCopyFailed(true);
          }
        }}
      >
        <span className="font-mono">
          {address.slice(0, 6)}…{address.slice(-6)}
        </span>
        {copied ? (
          <IconCheck className="size-3.5 text-foreground" aria-hidden="true" />
        ) : (
          <IconCopy className="size-3.5" aria-hidden="true" />
        )}
      </Button>
      <output className="sr-only">
        {copied
          ? "Wallet address copied."
          : copyFailed
            ? "Clipboard unavailable. Select the address to copy it."
            : ""}
      </output>
      {copyFailed && (
        <code className="block select-all break-all rounded-lg bg-muted/60 p-2 text-xs">
          {address}
        </code>
      )}
    </div>
  );
}
