import {
  Account,
  Address,
  Asset,
  Keypair,
  nativeToScVal,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  addressCredentials,
  validateSignedAuthorization,
} from "../src/lib/smart-account/server/policy";
import { TESTNET } from "../src/lib/smart-account/shared";
import {
  assertFreshSwap,
  quoteSchema,
  quoteFromRouter,
  swapFunction,
  validateQuote as validateParsedQuote,
  validateSwapAuthorization,
  validateSwapEnvelope,
} from "../src/lib/swaps/policy";
import { SWAP, type SwapIntent } from "../src/lib/swaps/shared";

// Deterministic adversarial fixtures, never used by the quote implementation.
const account = StrKey.encodeContract(Buffer.alloc(32, 1));
const pool = StrKey.encodeContract(Buffer.alloc(32, 2));
const other = StrKey.encodeContract(Buffer.alloc(32, 3));
const sponsor = Keypair.random();
const quotedAt = 1_800_000_000_000;
const intent: SwapIntent = {
  account,
  recipient: account,
  token: SWAP.xlm,
  units: "10000000",
  swap: {
    assetOut: "USDC",
    tokenOut: SWAP.usdc,
    router: SWAP.router,
    pool,
    expectedOut: "1000001",
    minimumOut: "995000",
    quoteSource: "soroswap_api",
    slippageBps: 50,
    quotedAt,
    expiresAt: quotedAt + 120_000,
    deadline: quotedAt / 1000 + 120,
  },
};

function validateQuote(value: unknown, amount: string) {
  return validateParsedQuote(quoteSchema.parse(value), amount);
}

function quote() {
  return {
    assetIn: SWAP.xlm,
    assetOut: SWAP.usdc,
    amountIn: "10000000",
    amountOut: "1000001",
    otherAmountThreshold: "995000",
    tradeType: "EXACT_IN",
    platform: "router",
    routePlan: [
      {
        swapInfo: { protocol: "soroswap", path: [SWAP.xlm, SWAP.usdc] },
        percent: "100",
      },
    ],
  };
}

function auth() {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(account).toScAddress(),
        nonce: xdr.Int64.fromString("8"),
        signatureExpirationLedger: 123,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
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
                  Address.fromString(account).toScVal(),
                  Address.fromString(pool).toScVal(),
                  nativeToScVal(BigInt(intent.units), { type: "i128" }),
                ],
              }),
            ),
          subInvocations: [],
        }),
      ],
    }),
  });
}

function envelope(
  options: {
    extra?: boolean;
    source?: string;
    deadline?: number;
    entry?: xdr.SorobanAuthorizationEntry;
    func?: xdr.HostFunction;
  } = {},
) {
  const builder = new TransactionBuilder(
    new Account(options.source ?? sponsor.publicKey(), "5"),
    { fee: "100", networkPassphrase: TESTNET.networkPassphrase },
  )
    .addOperation(
      Operation.invokeHostFunction({
        func: options.func ?? swapFunction(intent),
        auth: [options.entry ?? auth()],
      }),
    )
    .setTimebounds(0, options.deadline ?? intent.swap.deadline);
  if (options.extra)
    builder.addOperation(
      Operation.manageData({ name: "unexpected", value: "1" }),
    );
  return builder.build();
}

describe("reviewed Testnet quotes", () => {
  it("uses the live router return amount and rounds minimum output up using integers", () => {
    const output = BigInt("9007199254740993");
    const quote = quoteFromRouter(
      [BigInt(intent.units), output],
      intent.units,
      456,
    );
    expect(quote.expectedOut).toBe("9007199254740993");
    expect(BigInt(quote.minimumOut) * BigInt(10000)).toBeGreaterThanOrEqual(
      output * BigInt(9950),
    );
    expect((BigInt(quote.minimumOut) - BigInt(1)) * BigInt(10000)).toBeLessThan(
      output * BigInt(9950),
    );
    expect(() =>
      quoteFromRouter([BigInt(1), output], intent.units, 456),
    ).toThrow();
    expect(() =>
      quoteFromRouter([BigInt(intent.units), BigInt(0)], intent.units, 456),
    ).toThrow();
  });
  it("pins official SAC identities to the Testnet passphrase", () => {
    expect(Asset.native().contractId(TESTNET.networkPassphrase)).toBe(SWAP.xlm);
    expect(
      new Asset("USDC", SWAP.issuer).contractId(TESTNET.networkPassphrase),
    ).toBe(SWAP.usdc);
  });
  it("keeps exact integer output and rounding at the minimum boundary", () => {
    expect(validateQuote(quote(), intent.units)).toEqual({
      expectedOut: "1000001",
      minimumOut: "995000",
    });
    expect(() =>
      validateQuote(
        { ...quote(), otherAmountThreshold: "994999" },
        intent.units,
      ),
    ).toThrow(/minimum/);
  });
  it("rejects malformed integer strings without leaking bigint parser errors", () => {
    for (const amountOut of ["1.5", "1e7", "-1", "not-an-amount"]) {
      const parsed = quoteSchema.safeParse({ ...quote(), amountOut });
      expect(parsed.success).toBe(false);
    }
  });
  it.each([
    { platform: "sdex" },
    { platform: "aggregator" },
    { assetOut: other },
    { amountIn: "10000001" },
    { amountOut: 9007199254740992 },
    { amountOut: "0" },
    { otherAmountThreshold: "0" },
    { otherAmountThreshold: "1000002" },
    { platformFee: { feeBps: 50, feeAmount: 50000 } },
    {
      routePlan: [
        {
          swapInfo: { protocol: "sdex", path: [SWAP.xlm, SWAP.usdc] },
          percent: "100",
        },
      ],
    },
    {
      routePlan: [
        {
          swapInfo: {
            protocol: "soroswap",
            path: [SWAP.xlm, other, SWAP.usdc],
          },
          percent: "100",
        },
      ],
    },
  ])("rejects unsupported or altered quotes: %j", (change) => {
    expect(() =>
      validateQuote({ ...quote(), ...change }, intent.units),
    ).toThrow();
  });
  it("rejects expired quotes, extended deadlines, and redirected destinations", () => {
    expect(() => assertFreshSwap(intent, quotedAt + 119_999)).not.toThrow();
    expect(() => assertFreshSwap(intent, quotedAt + 120_000)).toThrow(
      /expired/,
    );
    expect(() =>
      assertFreshSwap({ ...intent, recipient: other }, quotedAt),
    ).toThrow();
    expect(() =>
      assertFreshSwap(
        {
          ...intent,
          swap: { ...intent.swap, deadline: intent.swap.deadline + 1 },
        },
        quotedAt,
      ),
    ).toThrow();
  });
});

describe("exact swap authorization tree", () => {
  it("accepts only the reviewed router call and exact pool transfer", () => {
    expect(() => validateSwapAuthorization(auth(), intent)).not.toThrow();
    const wrong = auth();
    wrong
      .rootInvocation()
      .subInvocations()[0]
      .function()
      .contractFn()
      .args()[1] = Address.fromString(other).toScVal();
    expect(() => validateSwapAuthorization(wrong, intent)).toThrow(
      /Authorization/,
    );
  });
  it.each([0, 1, 2, 3, 4])("rejects altered router argument %i", (index) => {
    const entry = auth();
    const args = entry.rootInvocation().function().contractFn().args();
    args[index] = xdr.ScVal.scvVoid();
    expect(() => validateSwapAuthorization(entry, intent)).toThrow();
  });
  it("rejects hidden approvals, extra branches, altered spend and signer", () => {
    for (const mutate of [
      (entry: xdr.SorobanAuthorizationEntry) =>
        entry.rootInvocation().subInvocations().push(auth().rootInvocation()),
      (entry: xdr.SorobanAuthorizationEntry) =>
        entry
          .rootInvocation()
          .subInvocations()[0]
          .subInvocations()
          .push(auth().rootInvocation()),
      (entry: xdr.SorobanAuthorizationEntry) =>
        entry
          .rootInvocation()
          .subInvocations()[0]
          .function()
          .contractFn()
          .functionName("approve"),
      (entry: xdr.SorobanAuthorizationEntry) =>
        (entry
          .rootInvocation()
          .subInvocations()[0]
          .function()
          .contractFn()
          .args()[2] = nativeToScVal(BigInt(10000001), { type: "i128" })),
      (entry: xdr.SorobanAuthorizationEntry) =>
        addressCredentials(entry).address(
          Address.fromString(other).toScAddress(),
        ),
    ]) {
      const entry = auth();
      mutate(entry);
      expect(() => validateSwapAuthorization(entry, intent)).toThrow();
    }
  });
  it("binds passkey authorization to the stored nonce, expiry and invocation", () => {
    const unsigned = auth().toXDR("base64");
    const signed = auth();
    addressCredentials(signed).signature(
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("fixture"),
          val: xdr.ScVal.scvBool(true),
        }),
      ]),
    );
    expect(() =>
      validateSignedAuthorization(unsigned, signed.toXDR("base64")),
    ).not.toThrow();
    addressCredentials(signed).nonce(xdr.Int64.fromString("9"));
    expect(() =>
      validateSignedAuthorization(unsigned, signed.toXDR("base64")),
    ).toThrow(/nonce/);
    expect(() => validateSignedAuthorization(unsigned, unsigned)).toThrow(
      /missing/,
    );
  });
  it("rejects extra transaction operations, changed source and relaxed time bounds", () => {
    const valid = envelope();
    expect(() =>
      validateSwapEnvelope(
        valid.toXDR(),
        valid.hash().toString("hex"),
        sponsor.publicKey(),
        intent,
      ),
    ).not.toThrow();
    for (const tx of [
      envelope({ extra: true }),
      envelope({ source: Keypair.random().publicKey() }),
      envelope({ deadline: intent.swap.deadline + 1 }),
      envelope({ deadline: 0 }),
    ])
      expect(() =>
        validateSwapEnvelope(
          tx.toXDR(),
          tx.hash().toString("hex"),
          sponsor.publicKey(),
          intent,
        ),
      ).toThrow();
    expect(() =>
      validateSwapEnvelope(
        valid.toXDR(),
        "0".repeat(64),
        sponsor.publicKey(),
        intent,
      ),
    ).toThrow();
  });
});
