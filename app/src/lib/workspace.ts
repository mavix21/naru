import "server-only";
import { api } from "@naru/backend/api";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { io } from "next/cache";
import { cache } from "react";

import { sessionIdentity } from "@/lib/auth/server";

// The shared shell and each workspace page read one snapshot per request.
export const workspaceSession = cache(async () => {
  // Convex initializes random logging IDs before fetching. Defer that work
  // beyond the static shell while retaining prefetching and private live reads.
  await io();
  const session = await sessionIdentity();

  if (!session) return null;

  // Companion settings are a fresh server snapshot; saving refreshes this tree.
  const companion = await fetchQuery(
    api.companions.current,
    {},
    { token: session.token },
  );

  return { ...session, companion };
});

export const preloadWorkspace = cache((token: string) => {
  const data = {
    conversation: preloadQuery(api.conversations.current, {}, { token }),
    operations: preloadQuery(api.operations.recent, {}, { token }),
    social: preloadQuery(api.social.current, {}, { token }),
    notifications: preloadQuery(api.notifications.current, {}, { token }),
    incomingPending: preloadQuery(
      api.operations.pendingIncomingCount,
      {},
      { token },
    ),
    inbox: preloadQuery(api.directMessages.inbox, {}, { token }),
    profile: fetchQuery(api.profiles.current, {}, { token }),
  };

  // A nested region may not render until another read resolves. Observe early
  // rejections now; each region still receives and surfaces its original error.
  void Promise.allSettled(Object.values(data));

  return data;
});

export type WorkspaceData = ReturnType<typeof preloadWorkspace>;
