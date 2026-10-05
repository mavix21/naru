import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { fetchQuery } from "convex/nextjs";

import { serverKey } from "../src/lib/auth/key";
import { SmartAccountService } from "../src/lib/smart-account/server/service";
import { maintainPublishedSplit } from "../src/lib/splits/server";

// Daily operator runner; default is inspection only. --apply renews only verified
// outstanding requests below seven days, using the existing 0.5-XLM sponsor cap.
const apply = process.argv.includes("--apply");
const service = new SmartAccountService();
let cursor: string | null = null;
let done = false;
while (!done) {
  const page: FunctionReturnType<typeof api.splits.maintenanceCandidates> =
    await fetchQuery(api.splits.maintenanceCandidates, {
      key: serverKey(),
      paginationOpts: { cursor, numItems: 50 },
    });
  for (const split of page.page) {
    try {
      console.log({
        splitId: split.creation?.id,
        ...(await maintainPublishedSplit(service, split, apply)),
      });
    } catch (error) {
      console.error({
        splitId: split.creation?.id,
        error:
          error instanceof Error ? error.message : "Maintenance unavailable",
      });
      process.exitCode = 1;
    }
  }
  cursor = page.continueCursor;
  done = page.isDone;
}
