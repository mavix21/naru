"use client";

import type { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";

import { z } from "zod";

let kit: Promise<typeof StellarWalletsKit> | undefined;

// The kit maps its theme to --swk-* custom properties, so Naru's own tokens
// (including dark mode) flow into the wallet-selection modal unchanged.
const theme = {
  background: "var(--card)",
  "background-secondary": "var(--muted)",
  "foreground-strong": "var(--foreground)",
  foreground: "var(--card-foreground)",
  "foreground-secondary": "var(--muted-foreground)",
  primary: "var(--primary)",
  "primary-foreground": "var(--primary-foreground)",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "var(--background)",
  light: "var(--muted)",
  "light-gray": "var(--border)",
  gray: "var(--muted-foreground)",
  danger: "var(--destructive)",
  border: "var(--border)",
  shadow: "0 18px 50px -20px rgba(0, 0, 0, 0.25)",
  "border-radius": "1.25rem",
  "font-family": "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
};

/**
 * Initializes Stellar Wallets Kit once, in the browser only. The kit touches
 * localStorage and custom elements at import time, so it is never imported
 * during server rendering.
 */
export function walletKit() {
  kit ??= (async () => {
    const [{ StellarWalletsKit }, { defaultModules }, { Networks }] =
      await Promise.all([
        import("@creit-tech/stellar-wallets-kit/sdk"),
        import("@creit-tech/stellar-wallets-kit/modules/utils"),
        import("@creit-tech/stellar-wallets-kit/types"),
      ]);

    // Wallets that need no extra configuration (Freighter, xBull, Albedo,
    // LOBSTR, Hana, Rabet, …); the modal marks the ones not installed.
    const modules = defaultModules();
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

    // WalletConnect needs a Reown project ID; without one the option is omitted.
    if (projectId) {
      const { WalletConnectModule, WalletConnectTargetChain } =
        await import("@creit-tech/stellar-wallets-kit/modules/wallet-connect");

      modules.push(
        new WalletConnectModule({
          projectId,
          allowedChains: [WalletConnectTargetChain.TESTNET],
          metadata: {
            name: "Naru",
            description: "Send a USDC tip on Stellar Testnet.",
            url: window.location.origin,
            icons: [`${window.location.origin}/naru.png`],
          },
        }),
      );
    }

    StellarWalletsKit.init({
      modules,
      network: Networks.TESTNET,
      theme,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });

    return StellarWalletsKit;
  })();

  kit.catch(() => {
    kit = undefined;
  });

  return kit;
}

// Kit and wallet failures are plain `{ code, message }` objects, not Errors.
export const kitError = z
  .object({ code: z.number().optional(), message: z.string().optional() })
  .catch({});

export function walletError(
  { code, message = "" }: z.infer<typeof kitError>,
  fallback: string,
) {
  if (/closed the modal/i.test(message))
    return "No wallet connected. Choose a wallet to continue.";

  if (/reject|declin|denied|cancel/i.test(message) || code === -4)
    return "You declined the wallet request. Nothing was sent.";

  if (/not (installed|available|found)/i.test(message))
    return "That wallet isn’t available in this browser. Install it or choose another wallet.";

  return message ? `${fallback} (${message.slice(0, 140)})` : fallback;
}
