"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";

export function ConvexClientProvider({
  children,
  url,
}: {
  children: ReactNode;
  url: string;
}) {
  const [client] = useState(
    () =>
      new ConvexReactClient(url, {
        // Keep server-preloaded private data until Clerk supplies its token.
        expectAuth: true,
        // Convex's console logger generates random IDs. Enable it only where
        // this client connects, so the provider can prerender the static shell.
        logger: typeof window !== "undefined",
      }),
  );

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
