import {
  Address,
  nativeToScVal,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";

import { addressCredentials } from "../smart-account/server/policy";
import { TESTNET } from "../smart-account/shared";
import { SWAP, swapTermsSchema, type SwapIntent } from "./shared";

const MAX_I128 = (BigInt(1) << BigInt(127)) - BigInt(1);

// The API sometimes returns JSON numbers. Reject unsafe integers before they
// can become a rounded amount; all application arithmetic uses bigint.
const units = z
  .union([
    z.string().regex(/^(0|[1-9]\d{0,38})$/),
    z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .transform(String),
  ])
  .pipe(z.string().refine((value) => BigInt(value) <= MAX_I128));

export const quoteSchema = z.object({
  assetIn: z.literal(SWAP.xlm),
  assetOut: z.literal(SWAP.usdc),
  amountIn: units,
  amountOut: units,
  otherAmountThreshold: units,
  tradeType: z.literal("EXACT_IN"),
  platform: z.literal("router"),
  routePlan: z
    .array(
      z.object({
        swapInfo: z.object({
          protocol: z.literal("soroswap"),
          path: z.tuple([z.literal(SWAP.xlm), z.literal(SWAP.usdc)]),
        }),
        percent: z.union([z.literal("100"), z.literal(100)]),
      }),
    )
    .length(1),
  platformFee: z.object({ feeBps: units, feeAmount: units }).nullish(),
});

type SoroswapQuote = z.infer<typeof quoteSchema>;

export function quoteFromRouter(
  amounts: [bigint, bigint],
  amountIn: string,
  ledger: number,
) {
  const [input, output] = amounts;

  if (
    input !== BigInt(amountIn) ||
    input <= BigInt(0) ||
    input > MAX_I128 ||
    output <= BigInt(0) ||
    output > MAX_I128 ||
    !Number.isSafeInteger(ledger) ||
    ledger <= 0
  )
    throw new Error("Soroswap returned invalid on-chain quote amounts.");

  // Round UP so even a one-unit quote never weakens the 0.5% protection.
  const minimum =
    (output * BigInt(10_000 - SWAP.slippageBps) + BigInt(9_999)) /
    BigInt(10_000);

  return {
    expectedOut: output.toString(),
    minimumOut: minimum.toString(),
    quoteSource: "soroswap_router" as const,
    quoteLedger: ledger,
  };
}

export function validateQuote(quote: SoroswapQuote, amountIn: string) {
  if (quote.amountIn !== amountIn || BigInt(quote.amountOut) <= BigInt(0))
    throw new Error(
      "Soroswap returned a different amount or insufficient liquidity.",
    );

  if (
    quote.platformFee &&
    (quote.platformFee.feeBps !== "0" || quote.platformFee.feeAmount !== "0")
  )
    throw new Error(
      "This Soroswap API key has a partner fee. Configure a zero-fee partner profile before preparing swaps.",
    );
  validateMinimum(quote.amountOut, quote.otherAmountThreshold);

  return {
    expectedOut: quote.amountOut,
    minimumOut: quote.otherAmountThreshold,
  };
}

function validateMinimum(expected: string, minimum: string) {
  const out = BigInt(expected);
  const min = BigInt(minimum);
  const floor = (out * BigInt(10_000 - SWAP.slippageBps)) / BigInt(10_000);

  if (out > MAX_I128 || min <= BigInt(0) || min > out || min < floor)
    throw new Error(
      "The quote does not protect the reviewed minimum USDC amount.",
    );
}

export function assertSwapIntent(intent: SwapIntent) {
  const terms = swapTermsSchema.parse(intent.swap);

  if (
    !StrKey.isValidContract(intent.account) ||
    !StrKey.isValidContract(terms.pool) ||
    intent.recipient !== intent.account ||
    intent.token !== SWAP.xlm ||
    !/^[1-9]\d{0,38}$/.test(intent.units) ||
    BigInt(intent.units) > MAX_I128 ||
    terms.expiresAt <= terms.quotedAt ||
    terms.expiresAt - terms.quotedAt > SWAP.lifetimeMs ||
    (terms.quoteSource === "soroswap_router" && !terms.quoteLedger) ||
    terms.deadline !== Math.floor(terms.expiresAt / 1000)
  )
    throw new Error("Swap terms do not match the reviewed Testnet swap.");
  validateMinimum(terms.expectedOut, terms.minimumOut);

  if (terms.targetOut && BigInt(terms.minimumOut) < BigInt(terms.targetOut))
    throw new Error("The swap does not protect your requested USDC amount.");
}

export function assertFreshSwap(intent: SwapIntent, now = Date.now()) {
  assertSwapIntent(intent);

  if (intent.swap.quotedAt > now || intent.swap.deadline * 1000 <= now)
    throw new Error(
      "Quote expired. Get a new quote and review it before authorizing.",
    );
}

export function swapFunction(intent: SwapIntent) {
  assertSwapIntent(intent);

  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(SWAP.router).toScAddress(),
      functionName: "swap_exact_tokens_for_tokens",
      args: [
        nativeToScVal(BigInt(intent.units), { type: "i128" }),
        nativeToScVal(BigInt(intent.swap.minimumOut), { type: "i128" }),
        xdr.ScVal.scvVec([
          Address.fromString(SWAP.xlm).toScVal(),
          Address.fromString(SWAP.usdc).toScVal(),
        ]),
        Address.fromString(intent.account).toScVal(),
        nativeToScVal(BigInt(intent.swap.deadline), { type: "u64" }),
      ],
    }),
  );
}

export function validateSwapAuthorization(
  entry: xdr.SorobanAuthorizationEntry,
  intent: SwapIntent,
) {
  const expected = new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        swapFunction(intent).invokeContract(),
      ),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(SWAP.xlm).toScAddress(),
              functionName: "transfer",
              args: [
                Address.fromString(intent.account).toScVal(),
                Address.fromString(intent.swap.pool).toScVal(),
                nativeToScVal(BigInt(intent.units), { type: "i128" }),
              ],
            }),
          ),
        subInvocations: [],
      }),
    ],
  });

  if (
    Address.fromScAddress(addressCredentials(entry).address()).toString() !==
      intent.account ||
    !entry.rootInvocation().toXDR().equals(expected.toXDR())
  )
    throw new Error(
      "Authorization does not match the reviewed swap, destination, and exact XLM spend.",
    );
}

export function validateSwapEnvelope(
  envelope: string,
  hash: string | null,
  sponsor: string,
  intent: SwapIntent,
) {
  const tx = TransactionBuilder.fromXDR(envelope, TESTNET.networkPassphrase);

  if (
    !(tx instanceof Transaction) ||
    tx.hash().toString("hex") !== hash ||
    tx.source !== sponsor ||
    tx.operations.length !== 1 ||
    !tx.timeBounds ||
    Number(tx.timeBounds.maxTime) > intent.swap.deadline ||
    Number(tx.timeBounds.maxTime) === 0 ||
    BigInt(tx.fee) > BigInt(5_000_000)
  )
    throw new Error(
      "Swap transaction evidence does not match the reviewed transaction.",
    );
  const op = tx.operations[0];

  if (
    op.type !== "invokeHostFunction" ||
    op.source ||
    !op.func.toXDR().equals(swapFunction(intent).toXDR()) ||
    op.auth?.length !== 1
  )
    throw new Error("Swap transaction contains an unexpected operation.");
  validateSwapAuthorization(op.auth[0], intent);
}
