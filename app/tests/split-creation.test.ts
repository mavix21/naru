import { contractShares, displayAmount } from "@naru/backend/money";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Memo,
  Operation,
  SorobanDataBuilder,
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
  creationFunction,
  createdSplitSchema,
  validateCreationAuthorization,
  validateCreationEnvelope,
  parseCreatedSplit,
  maintenanceFunction,
  splitStorageKey,
  validateMaintenanceEnvelope,
  type CreationIntent,
} from "../src/lib/splits/policy";

const accounts = [1, 200, 250].map((n) =>
  StrKey.encodeContract(Buffer.alloc(32, n)),
);
const intent: CreationIntent = {
  account: accounts[0],
  splitId: "ab".repeat(32),
  units: "120000001",
  participants: contractShares("12.0000001", accounts).map((s) => s.account),
};
const expires = 1_900_000_120_000;
const sponsor = Keypair.random().publicKey();
function authorization(terms = intent, signed = false) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(terms.account).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 100,
        signature: signed
          ? xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("fixture"),
                val: xdr.ScVal.scvBool(true),
              }),
            ])
          : xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          creationFunction(terms).invokeContract(),
        ),
      subInvocations: [],
    }),
  });
}
function envelope(
  options: {
    auth?: xdr.SorobanAuthorizationEntry[];
    extra?: boolean;
    memo?: boolean;
    terms?: CreationIntent;
    source?: string;
  } = {},
) {
  const builder = new TransactionBuilder(
    new Account(options.source ?? sponsor, "9"),
    { fee: "100", networkPassphrase: TESTNET.networkPassphrase },
  )
    .addOperation(
      Operation.invokeHostFunction({
        func: creationFunction(options.terms ?? intent),
        auth: options.auth ?? [authorization(intent, true)],
      }),
    )
    .setTimebounds(0, expires / 1000);
  if (options.extra)
    builder.addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    );
  if (options.memo) builder.addMemo(Memo.text("private description"));
  return builder.build();
}

describe("NaruSplit integer arithmetic", () => {
  it("matches raw Soroban contract-address ordering rather than display string order", () => {
    const varied = Array.from({ length: 13 }, (_, i) =>
      StrKey.encodeContract(Buffer.alloc(32, i * 19)),
    );
    const nativeOrder = [...varied].sort((a, b) =>
      Buffer.compare(
        Address.fromString(a).toScAddress().toXDR(),
        Address.fromString(b).toScAddress().toXDR(),
      ),
    );
    expect(
      contractShares("0.0000014", varied.reverse()).map((s) => s.account),
    ).toEqual(nativeOrder);
    expect(contractShares("0.0000014", varied)[0].units).toBe("2");
    expect(
      contractShares("0.0000014", varied)
        .slice(1)
        .every((s) => s.units === "1"),
    ).toBe(true);
  });
  it("conserves totals through i128 max for all participant counts and reordered retries", () => {
    for (let n = 2; n <= 13; n++) {
      const list = Array.from({ length: n }, (_, i) =>
        StrKey.encodeContract(Buffer.alloc(32, i + 1)),
      );
      for (const total of [
        BigInt(n),
        BigInt(n * 2 + 1),
        (BigInt(1) << BigInt(127)) - BigInt(1),
      ]) {
        const shares = contractShares(displayAmount(total.toString()), list);
        expect(
          shares.reduce((sum, s) => sum + BigInt(s.units), BigInt(0)),
        ).toBe(total);
        expect(
          contractShares(displayAmount(total.toString()), [...list].reverse()),
        ).toEqual(shares);
      }
    }
  });
  it("rejects invalid precision, amounts, counts, duplicate accounts and omitted organizer", () => {
    for (const amount of [
      "0",
      "0.0000001",
      "1.00000001",
      "1e3",
      "17014118346046923173168730371588.4105728",
    ])
      expect(() => contractShares(amount, accounts)).toThrow();
    for (const list of [
      [accounts[0]],
      [accounts[0], accounts[0]],
      Array(14).fill(accounts[0]),
    ])
      expect(() => contractShares("12", list)).toThrow();
    expect(() =>
      creationFunction({
        ...intent,
        account: StrKey.encodeContract(Buffer.alloc(32, 9)),
      }),
    ).toThrow();
  });
});

describe("bounded split maintenance and restoration", () => {
  function maintenance(
    options: {
      fee?: string;
      auth?: xdr.SorobanAuthorizationEntry[];
      func?: xdr.HostFunction;
      restore?: xdr.LedgerKey;
    } = {},
  ) {
    const builder = new TransactionBuilder(new Account(sponsor, "9"), {
      fee: options.fee ?? "100",
      networkPassphrase: TESTNET.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: options.func ?? maintenanceFunction(intent),
          auth: options.auth ?? [],
        }),
      )
      .setTimebounds(0, expires / 1000);
    if (options.restore) {
      const data = new SorobanDataBuilder()
        .setReadWrite([options.restore])
        .build();
      data.ext(
        new xdr.SorobanTransactionDataExt(
          1,
          new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: [0] }),
        ),
      );
      builder.setSorobanData(data);
    }
    return builder.build();
  }
  const check = (tx: ReturnType<typeof maintenance>) =>
    validateMaintenanceEnvelope(
      tx.toXDR(),
      tx.hash().toString("hex"),
      sponsor,
      intent,
      expires,
    );
  it("allows permissionless renewal and restoration of only the original split key", () => {
    expect(() => check(maintenance())).not.toThrow();
    expect(() =>
      check(maintenance({ restore: splitStorageKey(intent) })),
    ).not.toThrow();
    expect(() =>
      check(
        maintenance({
          restore: splitStorageKey({ ...intent, splitId: "ff".repeat(32) }),
        }),
      ),
    ).toThrow(/separate maintenance/);
    expect(() =>
      check(
        maintenance({
          restore: xdr.LedgerKey.contractCode(
            new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 1) }),
          ),
        }),
      ),
    ).toThrow(/separate maintenance/);
  });
  it("keeps the 0.5-XLM cap and rejects extra authorization and non-maintenance calls", () => {
    expect(() => check(maintenance({ fee: "5000000" }))).not.toThrow();
    expect(() => check(maintenance({ fee: "5000001" }))).toThrow(/Invalid/);
    expect(() =>
      check(maintenance({ auth: [authorization(intent, true)] })),
    ).toThrow(/permissionless/);
    expect(() =>
      check(maintenance({ func: creationFunction(intent) })),
    ).toThrow(/permissionless/);
  });
});

describe("creation authorization and receipt policy", () => {
  it("rejects changed terms, another organizer, nested asset transfers, and missing passkey signatures", () => {
    const reviewed = authorization().toXDR("base64");
    expect(() => validateSignedAuthorization(reviewed, reviewed)).toThrow(
      /missing/,
    );
    for (const change of [
      { units: "120000002" },
      { splitId: "cd".repeat(32) },
      { account: accounts[1] },
    ]) {
      const changed = authorization({ ...intent, ...change }, true);
      expect(() => validateCreationAuthorization(changed, intent)).toThrow();
      expect(() =>
        validateSignedAuthorization(reviewed, changed.toXDR("base64")),
      ).toThrow(/changed/);
    }
    const nested = authorization(intent, true);
    nested.rootInvocation().subInvocations([authorization().rootInvocation()]);
    expect(() => validateCreationAuthorization(nested, intent)).toThrow(
      /unexpected/,
    );
    const nonce = authorization(intent, true);
    addressCredentials(nonce).nonce(xdr.Int64.fromString("8"));
    expect(() =>
      validateSignedAuthorization(reviewed, nonce.toXDR("base64")),
    ).toThrow();
  });
  it("accepts only the exact single-call sponsored envelope and complete reviewed auth", () => {
    const check = (tx: ReturnType<typeof envelope>) =>
      validateCreationEnvelope(
        tx.toXDR(),
        tx.hash().toString("hex"),
        sponsor,
        intent,
        authorization().toXDR("base64"),
        expires,
      );
    expect(() => check(envelope())).not.toThrow();
    for (const options of [
      { extra: true },
      { memo: true },
      { source: Keypair.random().publicKey() },
      { auth: [] },
      { auth: [authorization(intent, true), authorization(intent, true)] },
      { terms: { ...intent, units: "99" } },
    ])
      expect(() => check(envelope(options))).toThrow();
  });
  it("requires matching immutable chain terms and preserves terminal states during recovery", () => {
    const value = {
      recipient: intent.account,
      total: BigInt(intent.units),
      created_ledger: 10,
      shares: contractShares("12.0000001", accounts).map((s) => ({
        participant: s.account,
        amount: BigInt(s.units),
        state: s.account === intent.account ? ["Organizer"] : ["Paid", 11],
      })),
    };
    expect(
      parseCreatedSplit(createdSplitSchema.parse(value), intent).shares.filter(
        (s) => s.state[0] === "Paid",
      ),
    ).toHaveLength(2);
    for (const changed of [
      null,
      { ...value, total: BigInt(12) },
      { ...value, recipient: accounts[1] },
      { ...value, shares: value.shares.slice(1) },
      { ...value, shares: [...value.shares].reverse() },
      {
        ...value,
        shares: value.shares.map((s) => ({
          ...s,
          amount: s.amount + BigInt(1),
        })),
      },
    ])
      expect(() =>
        parseCreatedSplit(createdSplitSchema.parse(changed), intent),
      ).toThrow();
  });
});
