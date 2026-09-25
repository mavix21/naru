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
  const [client] = useState(() => new ConvexReactClient(url));

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
