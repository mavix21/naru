"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";

import { NotificationProvider } from "../providers/NotificationProvider";
import { WalletProvider } from "../providers/WalletProvider";

function OptionalWalletProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const withoutWallet =
    pathname === "/sign-in" ||
    pathname?.startsWith("/sign-in/") ||
    pathname === "/sign-up" ||
    pathname?.startsWith("/sign-up/");

  return withoutWallet ? children : <WalletProvider>{children}</WalletProvider>;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: false },
        },
      }),
  );

  return (
    <NotificationProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={children}>
          <OptionalWalletProvider>{children}</OptionalWalletProvider>
        </Suspense>
      </QueryClientProvider>
    </NotificationProvider>
  );
}
