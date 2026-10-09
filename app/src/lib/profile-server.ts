import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";

import { serverKey } from "./auth/key";
import { synchronizeIdentity } from "./profile-sync";

export { ProfileConflict } from "./profile-sync";

export async function synchronizeProfile(
  clerkUserId: string,
  requested?: string,
) {
  const { users } = await clerkClient();

  return synchronizeIdentity(
    { users, mutate: fetchMutation, key: serverKey() },
    clerkUserId,
    requested,
  );
}
