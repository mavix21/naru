import "server-only";
import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";

import { serverKey } from "@/lib/auth/server";

export type RecordEntry = NonNullable<
  FunctionReturnType<typeof api.sponsorship.get>
>;

export class SponsorStore {
  private key = serverKey();

  get(id: string) {
    return fetchQuery(api.sponsorship.get, { key: this.key, id });
  }

  inFlight() {
    return fetchQuery(api.sponsorship.inFlight, { key: this.key });
  }

  accountJobs(account: string) {
    return fetchQuery(api.sponsorship.accountJobs, { key: this.key, account });
  }

  insert(
    id: string,
    account: string,
    kind: RecordEntry["kind"],
    func: string,
    auth: string,
    expires: number,
  ) {
    return fetchMutation(api.sponsorship.insert, {
      key: this.key,
      id,
      account,
      kind,
      func,
      auth,
      expires,
    });
  }

  rate(bucket: string, maximum: number) {
    return fetchMutation(api.sponsorship.rate, {
      key: this.key,
      bucket,
      maximum,
    });
  }

  claim(id: string) {
    return fetchMutation(api.sponsorship.claim, { key: this.key, id });
  }

  pending(id: string, hash: string, envelope: string) {
    return fetchMutation(api.sponsorship.pending, {
      key: this.key,
      id,
      hash,
      envelope,
    });
  }

  finish(
    id: string,
    state: "confirmed" | "failed",
    ledger: number | null,
    error: string | null,
    expectedState: RecordEntry["state"],
  ) {
    return fetchMutation(api.sponsorship.finish, {
      key: this.key,
      id,
      state,
      ledger,
      error,
      expectedState,
    });
  }

  recover(id: string) {
    return fetchMutation(api.sponsorship.recover, { key: this.key, id });
  }
}
