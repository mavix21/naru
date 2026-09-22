"use client";

import type { MappedBalances } from "@stellar-scaffold/app-lib/wallet";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * A good-enough implementation of deepEqual.
 *
 * Used in this file to compare MappedBalances.
 *
 * Should maybe add & use a new dependency instead, if needed elsewhere.
 */
function deepEqual<T>(a: T, b: T): boolean {
  if (a === b) {
    return true;
  }

  const bothAreObjects =
    a && b && typeof a === "object" && typeof b === "object";

  return Boolean(
    bothAreObjects &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([k, v]) => deepEqual(v, b[k as keyof T])),
  );
}

export interface WalletContextType {
  address?: string;
  balances: MappedBalances;
  isPending: boolean;
  networkPassphrase?: string;
  signTransaction: typeof import("@stellar-scaffold/app-lib/wallet").signTransaction;
  updateBalances: () => Promise<void>;
}

const signTransaction: WalletContextType["signTransaction"] = async (
  ...args
) => {
  const wallet = await import("@stellar-scaffold/app-lib/wallet");
  return wallet.signTransaction(...args);
};

export const WalletContext = createContext<WalletContextType>({
  isPending: true,
  balances: {},
  updateBalances: async () => {},
  signTransaction,
});

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [balances, setBalances] = useState<MappedBalances>({});
  const [address, setAddress] = useState<string>();
  const [networkPassphrase, setNetworkPassphrase] = useState<string>();
  const [isPending, setIsPending] = useState(true);

  const updateBalances = useCallback(async () => {
    if (!address) return;

    const { fetchBalances } = await import("@stellar-scaffold/app-lib/wallet");
    const newBalances = await fetchBalances(address);
    setBalances((prev) => {
      if (deepEqual(newBalances, prev)) return prev;
      return newBalances;
    });
  }, [address]);

  // Refetch on address change (via `updateBalances`' identity) and on network
  // change — the same address holds different balances per network.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- balances come from an asynchronous wallet/network request.
    void updateBalances();
  }, [updateBalances, networkPassphrase]);

  // Subscribe to wallet state. Gets values immediately and on every subsequent
  // change: connect, disconnect, and the wallet switching networks.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;
    void import("@stellar-scaffold/app-lib/wallet").then(
      ({ onWalletChange }) => {
        if (!mounted) return;
        unsubscribe = onWalletChange((state) => {
          setAddress(state.address);
          setNetworkPassphrase(state.networkPassphrase);
          setIsPending(false);
          if (!state.address) setBalances({});
        });
      },
    );
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      address,
      networkPassphrase,
      balances,
      updateBalances,
      isPending,
      signTransaction,
    }),
    [address, networkPassphrase, balances, updateBalances, isPending],
  );

  return <WalletContext value={contextValue}>{children}</WalletContext>;
};
