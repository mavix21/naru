import "server-only";
import type { FunctionReturnType } from "convex/server";

import { api } from "@naru/backend/api";
import { NARU_SPLIT } from "@naru/backend/money";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { fetchMutation } from "convex/nextjs";
import { randomUUID } from "node:crypto";

import type { RecordEntry } from "@/lib/smart-account/server/store";

import { serverKey } from "@/lib/auth/server";
import { addressCredentials } from "@/lib/smart-account/server/policy";
import {
  SmartAccountService,
  stellarRpc,
} from "@/lib/smart-account/server/service";

import {
  createdSplitSchema,
  parseCreatedSplit,
  sharePaymentFunction,
  validateSharePaymentAuthorization,
  validateSharePaymentEnvelope,
} from "./policy";
import { creationIntent, requireSplitContract } from "./server";

type PaymentTerms = FunctionReturnType<typeof api.splits.paymentTerms>;

export async function readPaymentShare(
  service: SmartAccountService,
  terms: PaymentTerms,
) {
  await requireSplitContract(service);

  const state = parseCreatedSplit(
    createdSplitSchema.parse(
      await service.readContract(NARU_SPLIT.contract, "get", [
        Address.fromString(terms.intent.organizer).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(terms.intent.splitId, "hex")),
      ]),
    ),
    creationIntent(terms.split),
  );

  const share = state.shares.find(
    (s) => s.participant === terms.intent.account,
  );

  if (!share || share.amount.toString() !== terms.intent.units)
    throw new Error("This request does not match its on-chain share.");

  return share;
}

export async function requirePayableShare(
  service: SmartAccountService,
  terms: PaymentTerms,
) {
  const share = await readPaymentShare(service, terms);

  if (share.state[0] !== "Outstanding")
    throw new Error(
      "This share is already paid or cancelled. Refresh its status.",
    );
  await Promise.all([
    service.requireAccount(terms.intent.account),
    service.requireAccount(terms.intent.organizer),
    service.requireTransferBalance(
      terms.intent.account,
      "USDC",
      terms.intent.units,
    ),
  ]);
}

export async function reviewSharePayment(
  service: SmartAccountService,
  terms: PaymentTerms,
) {
  await requirePayableShare(service, terms);
  const func = sharePaymentFunction(terms.intent);

  const simulation = await stellarRpc.simulateTransaction(
    await service.transaction(func, []),
    undefined,
    "record",
    true,
  );

  if (
    !rpc.Api.isSimulationSuccess(simulation) ||
    simulation.result?.auth?.length !== 1
  )
    throw new Error("Your share could not be reviewed. No payment was sent.");
  const entry = simulation.result.auth[0];
  validateSharePaymentAuthorization(entry, terms.intent);
  const expiration = simulation.latestLedger + 60;
  addressCredentials(entry).signatureExpirationLedger(expiration);
  addressCredentials(entry).signature(xdr.ScVal.scvVoid());
  const auth = entry.toXDR("base64");
  const expiresAt = Date.now() + 120_000;
  const id = randomUUID();
  await service.store.insert(
    id,
    terms.intent.account,
    "split_pay",
    func.toXDR("base64"),
    auth,
    expiresAt,
  );

  return { id, auth, expiration, expiresAt, intent: terms.intent };
}

export function assertSharePaymentJob(
  service: SmartAccountService,
  job: RecordEntry,
  terms: PaymentTerms,
) {
  if (
    job.kind !== "split_pay" ||
    job.account !== terms.intent.account ||
    job.func !== sharePaymentFunction(terms.intent).toXDR("base64")
  )
    throw new Error("Payment journal does not match this request.");
  validateSharePaymentAuthorization(
    xdr.SorobanAuthorizationEntry.fromXDR(job.auth, "base64"),
    terms.intent,
  );

  if (job.envelope)
    validateSharePaymentEnvelope(
      job.envelope,
      job.hash,
      service.config.publicConfig.sponsor,
      terms.intent,
      job.auth,
      job.expires,
    );
  else if (job.state === "confirmed")
    throw new Error("Confirmed payment envelope missing.");
}

export async function reconcileSharePayment(
  service: SmartAccountService,
  terms: PaymentTerms,
  token: string,
) {
  if (terms.request.state !== "submitting" || !terms.request.settlement) return;
  let job = await service.store.get(terms.request.settlement.reviewId);

  if (!job) throw new Error("Saved payment journal unavailable.");
  assertSharePaymentJob(service, job, terms);

  if (job.state === "review" && job.expires <= Date.now()) {
    await service.store.finish(
      job.id,
      "failed",
      null,
      "Payment was interrupted before submission. Review again.",
      "review",
    );
    job = (await service.store.get(job.id))!;
  }

  const result = await service.reconcile(job);

  if (result.state !== "confirmed" && result.state !== "failed") return;
  let paidLedger: number | undefined;

  let balances:
    | {
        sender: Awaited<ReturnType<typeof service.walletBalances>>;
        recipient: Awaited<ReturnType<typeof service.walletBalances>>;
      }
    | undefined;

  if (result.state === "confirmed") {
    assertSharePaymentJob(service, (await service.store.get(job.id))!, terms);
    const share = await readPaymentShare(service, terms);

    if (share.state[0] !== "Paid" || share.state[1] !== result.ledger)
      throw new Error("Payment confirmation does not match the settled share.");

    paidLedger = share.state[1];

    const [sender, recipient] = await Promise.all([
      service.walletBalances(terms.intent.account),
      service.walletBalances(terms.intent.organizer),
    ]);

    balances = { sender, recipient };
  }

  await fetchMutation(
    api.splits.reportPayment,
    {
      key: serverKey(),
      id: terms.request._id,
      reviewId: job.id,
      paidLedger,
      balances,
    },
    { token },
  );
}
