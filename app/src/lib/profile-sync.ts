import type { createClerkClient } from "@clerk/backend";
import type { fetchMutation } from "convex/nextjs";

import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { api } from "@naru/backend/api";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { suggestedDisplayName } from "./profile";

export class ProfileConflict extends Error {}

// Shared by session recovery, completion, and signed Clerk webhooks. Naru's
// committed handle is authoritative; Clerk is its signup input and auth mirror.
export async function synchronizeIdentity(
  services: {
    users: Pick<
      ReturnType<typeof createClerkClient>["users"],
      "getUser" | "updateUser"
    >;
    mutate: typeof fetchMutation;
    key: string;
  },
  clerkUserId: string,
  requested?: string,
) {
  const user = await services.users.getUser(clerkUserId);
  const credentials = { key: services.key, clerkUserId };

  const identity = await services.mutate(api.profiles.seedIdentity, {
    ...credentials,
    suggestedName: suggestedDisplayName(user),
  });

  const candidate =
    identity.username ?? identity.pendingUsername ?? requested ?? user.username;

  if (!candidate) return { username: null };

  let prepared;

  try {
    prepared = await services.mutate(api.profiles.prepareUsername, {
      ...credentials,
      username: candidate,
    });
  } catch (error) {
    if (error instanceof ConvexError) {
      const message = z.string().safeParse(error.data);

      if (message.success) throw new ProfileConflict(message.data);
    }

    throw error;
  }

  try {
    if (user.username !== prepared.username)
      await services.users.updateUser(clerkUserId, {
        username: prepared.username,
      });
  } catch (error) {
    // Only definitive validation failures release a reservation. Timeouts,
    // rate limits and 5xx may have committed: retain it for an idempotent retry.
    if (isClerkAPIResponseError(error) && [400, 422].includes(error.status)) {
      if (prepared.claimId)
        await services.mutate(api.profiles.releaseUsername, {
          ...credentials,
          claimId: prepared.claimId,
        });

      const taken = error.errors.some(
        (item) => item.code === "form_identifier_exists",
      );

      throw new ProfileConflict(
        identity.username
          ? "Your public username is preserved, but Clerk could not synchronize it. Contact support to reconcile your account."
          : taken
            ? "That username is already taken. Choose another."
            : "Clerk could not accept that username. Try another, or contact support if the problem continues.",
      );
    }

    throw error;
  }

  if (prepared.claimId)
    await services.mutate(api.profiles.finishUsername, {
      ...credentials,
      claimId: prepared.claimId,
      username: prepared.username,
    });

  return { username: prepared.username };
}
