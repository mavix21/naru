import "server-only";
import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { rpc, scValToBigInt, xdr } from "@stellar/stellar-sdk";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { randomUUID } from "node:crypto";

import type { RecordEntry } from "@/lib/smart-account/server/store";

import { serverKey } from "@/lib/auth/server";
import { displayAmount, parseAmount } from "@/lib/money";
import { readPaymentStatus } from "@/lib/smart-account/server/payments-http";
import {
  addressCredentials,
  validateSignedAuthorization,
} from "@/lib/smart-account/server/policy";
import {
  SmartAccountService,
  stellarRpc,
} from "@/lib/smart-account/server/service";

import {
  requestSwapQuote,
  requestSwapQuoteForOutput,
  verifySwapMarket,
} from "./market";
import {
  assertFreshSwap,
  assertSwapIntent,
  swapFunction,
  validateSwapAuthorization,
  validateSwapEnvelope,
} from "./policy";
import { SWAP, swapTermsSchema, type SwapIntent } from "./shared";

export async function prepareSwapReview(
  service: SmartAccountService,
  account: string,
  amount: string,
  amountType: "spend" | "receive" = "spend",
) {
  if (!process.env.NARU_SOROSWAP_API_KEY)
    throw new Error("Swaps need NARU_SOROSWAP_API_KEY on the server.");
  await service.store.rate(
    `swap-review:${Math.floor(Date.now() / 60_000)}`,
    30,
  );
  await service.requireAccount(account);

  const requested = parseAmount(
    amount,
    amountType === "receive" ? "USDC" : "XLM",
  );

  const balance = BigInt(await service.balance(account));

  if (amountType === "spend" && balance < BigInt(requested.units))
    throw new Error(
      "You don’t have enough XLM for this swap. Choose a smaller amount or add test XLM in Account.",
    );
  const market = await verifySwapMarket(service.config.publicConfig.sponsor);
  const quotedAt = Date.now();

  const quote =
    amountType === "receive"
      ? await requestSwapQuoteForOutput(
          requested.units,
          service.config.publicConfig.sponsor,
        )
      : {
          ...(await requestSwapQuote(
            requested.units,
            service.config.publicConfig.sponsor,
          )),
          amountIn: requested.units,
        };

  const parsed = parseAmount(displayAmount(quote.amountIn));

  if (balance < BigInt(parsed.units))
    throw new Error(
      `Receiving ${requested.amount} USDC currently requires ${parsed.amount} XLM, but you have ${displayAmount(balance.toString())} XLM. Choose a smaller USDC amount or add test XLM in Account.`,
    );

  if (BigInt(quote.expectedOut) >= market.reserveOut)
    throw new Error(
      "There is not enough USDC liquidity for the quoted amount.",
    );
  const expiresAt = Math.floor((quotedAt + SWAP.lifetimeMs) / 1000) * 1000;

  const swap = swapTermsSchema.parse({
    ...quote,
    assetOut: "USDC",
    tokenOut: SWAP.usdc,
    router: SWAP.router,
    pool: market.pool,
    slippageBps: SWAP.slippageBps,
    quotedAt,
    expiresAt,
    deadline: expiresAt / 1000,
  });

  const intent: SwapIntent = {
    account,
    recipient: account,
    token: SWAP.xlm,
    units: parsed.units,
    swap,
  };

  const func = swapFunction(intent);

  const simulation = await stellarRpc.simulateTransaction(
    await service.transaction(func, [], swap.deadline),
    undefined,
    "record",
    true,
  );

  if (
    !rpc.Api.isSimulationSuccess(simulation) ||
    simulation.result?.auth?.length !== 1
  )
    throw new Error(
      "This swap cannot currently meet its minimum USDC amount. Get a new quote or try a smaller amount.",
    );
  const entry = simulation.result.auth[0];
  validateSwapAuthorization(entry, intent);
  const outputs = simulation.result.retval.vec();

  if (
    outputs?.length !== 2 ||
    scValToBigInt(outputs[0]) !== BigInt(parsed.units) ||
    scValToBigInt(outputs[1]) < BigInt(swap.minimumOut)
  )
    throw new Error("The simulated swap did not match the reviewed amounts.");
  addressCredentials(entry).signatureExpirationLedger(
    simulation.latestLedger + 30,
  );
  addressCredentials(entry).signature(xdr.ScVal.scvVoid());
  assertFreshSwap(intent);
  const reviewId = randomUUID();
  await service.store.insert(
    reviewId,
    account,
    "swap",
    func.toXDR("base64"),
    entry.toXDR("base64"),
    expiresAt,
  );

  return { ...parsed, swap, reviewId };
}

export function operationIntent(operation: Doc<"operations">): SwapIntent {
  if (!operation.swap) throw new Error("Swap not found.");
  const intent = { ...operation, swap: swapTermsSchema.parse(operation.swap) };
  assertSwapIntent(intent);

  if (
    parseAmount(operation.amount).units !== intent.units ||
    operation.recipientUserId !== operation.clerkUserId
  )
    throw new Error("The saved swap amount or destination changed.");

  return intent;
}

export function assertSwapJob(
  job: RecordEntry,
  intent: SwapIntent,
  sponsor: string,
) {
  if (
    job.kind !== "swap" ||
    job.account !== intent.account ||
    job.expires !== intent.swap.expiresAt ||
    job.func !== swapFunction(intent).toXDR("base64")
  )
    throw new Error("Transaction does not match the reviewed swap.");
  validateSwapAuthorization(
    xdr.SorobanAuthorizationEntry.fromXDR(job.auth, "base64"),
    intent,
  );

  if (job.envelope)
    validateSwapEnvelope(job.envelope, job.hash, sponsor, intent);
  else if (job.state === "confirmed")
    throw new Error("Confirmed swap envelope is missing.");
}

export async function validateSwapOwner(
  operation: Doc<"operations">,
  token: string,
  service: SmartAccountService,
) {
  const intent = operationIntent(operation);
  assertFreshSwap(intent);
  const payment = await fetchQuery(api.payments.current, {}, { token });

  if (payment?.state !== "ready" || payment.account !== intent.account)
    throw new Error("This swap does not belong to your active Naru account.");
  await service.requireAccount(intent.account);

  if (BigInt(await service.balance(intent.account)) < BigInt(intent.units))
    throw new Error("You don’t have enough XLM for this swap.");

  return intent;
}

export async function signedSwap(
  operation: Doc<"operations">,
  job: RecordEntry,
  signedXdr: string,
  service: SmartAccountService,
) {
  const intent = operationIntent(operation);
  assertFreshSwap(intent);
  assertSwapJob(job, intent, service.config.publicConfig.sponsor);
  const signed = validateSignedAuthorization(job.auth, signedXdr);
  validateSwapAuthorization(signed, intent);
  const market = await verifySwapMarket(service.config.publicConfig.sponsor);

  if (
    market.pool !== intent.swap.pool ||
    market.reserveOut <= BigInt(intent.swap.minimumOut)
  )
    throw new Error("The reviewed swap liquidity is no longer available.");
  assertFreshSwap(intent);

  return signed;
}

export async function reconcileSwap(
  operation: Doc<"operations">,
  token: string,
  service: SmartAccountService,
) {
  if (operation.state !== "submitting" || !operation.reviewId) return;
  const intent = operationIntent(operation);
  let record = await service.store.get(operation.reviewId);

  if (!record) throw new Error("Swap transaction record is unavailable.");
  assertSwapJob(record, intent, service.config.publicConfig.sponsor);

  if (record.state === "review" && record.expires <= Date.now()) {
    await service.store.finish(
      record.id,
      "failed",
      null,
      "Authorization was interrupted. No transaction was sent.",
      "review",
    );
    record = (await service.store.get(record.id))!;
  }

  const job = await service.reconcile(record);
  let receivedUnits: string | undefined;

  if (job.state === "confirmed") {
    const confirmed = (await service.store.get(record.id))!;
    assertSwapJob(confirmed, intent, service.config.publicConfig.sponsor);

    if (!job.hash || !job.ledger || !confirmed.result)
      throw new Error("Confirmed swap result is unavailable.");
    const outputs = xdr.ScVal.fromXDR(confirmed.result, "base64").vec();

    if (
      outputs?.length !== 2 ||
      scValToBigInt(outputs[0]) !== BigInt(intent.units) ||
      scValToBigInt(outputs[1]) < BigInt(intent.swap.minimumOut)
    )
      throw new Error("Confirmed swap amounts do not match the reviewed swap.");
    receivedUnits = scValToBigInt(outputs[1]).toString();
    // Refresh both assets before publishing the confirmed receipt. If this
    // request is interrupted, the submitting operation is reconciled again.
    await readPaymentStatus(service, token, null);
  }

  await fetchMutation(
    api.operations.change,
    {
      key: serverKey(),
      id: operation._id,
      revision: operation.revision,
      action: {
        kind: "report",
        reviewId: record.id,
        state:
          job.state === "confirmed"
            ? "confirmed"
            : job.state === "failed"
              ? "failed"
              : "submitting",
        hash: job.hash,
        error: job.error,
        receivedUnits,
      },
    },
    { token },
  );
}
