"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { NotificationProvider } from "../providers/NotificationProvider";

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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NotificationProvider>
  );
}
