import { createClerkClient } from "@clerk/backend";
import { fetchMutation } from "convex/nextjs";

import { serverKey } from "../src/lib/auth/key";
import { ProfileConflict, synchronizeIdentity } from "../src/lib/profile-sync";

const { users } = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const services = { users, mutate: fetchMutation, key: serverKey() };

let offset = 0;

let failed = 0;

// One-time rollout backfill, also safe to re-run for interrupted claims. Each
// user is fetched fresh by the same coordinator used by sessions and webhooks.
for (;;) {
  const page = await users.getUserList({
    limit: 100,
    offset,
    orderBy: "+created_at",
  });

  for (const user of page.data) {
    try {
      await synchronizeIdentity(services, user.id);
    } catch (error) {
      failed++;
      console.error(
        `${user.id}: ${error instanceof ProfileConflict ? error.message : "Synchronization failed; retry this command."}`,
      );
    }
  }

  offset += page.data.length;

  if (!page.data.length || offset >= page.totalCount) break;
}

console.log(`Processed ${offset} profiles; ${failed} need attention.`);

if (failed) process.exitCode = 1;
