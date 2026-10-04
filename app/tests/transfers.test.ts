import {
  assertTransferAmount,
  parseAmount,
  TESTNET_ASSETS,
  transferShortfall,
} from "@naru/backend/money";
import {
  Account,
  Address,
  Keypair,
  Memo,
  nativeToScVal,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { directTransferRequest } from "../src/lib/conversation/transfer-request";
import {
  addressCredentials,
  validateSignedAuthorization,
} from "../src/lib/smart-account/server/policy";

describe("explicit transfer tool routing", () => {
  const selected = (text: string, label = "@juan") => [
    {
      userId: "verified-friend-id",
      label,
      start: text.indexOf(label),
      end: text.indexOf(label) + label.length,
    },
  ];

  it.each([
    ["send 1 USDC to @juan", "1", "USDC"],
    ["Please send 0.0000001 usdc to @juan.", "0.0000001", "USDC"],
    ["Transfer 2 XLM to @juan please", "2", "XLM"],
    ["Envía 1 USDC a @juan", "1", "USDC"],
  ])(
    "routes %s to the exact selected friend's review",
    (text, amount, asset) => {
      expect(directTransferRequest(text, selected(text))).toEqual({
        userId: "verified-friend-id",
        amount,
        asset,
      });
    },
  );

  it("requires friend selection rather than resolving typed names or stale mention ranges", () => {
    const text = "send 1 USDC to @juan";
    expect(directTransferRequest(text, [])?.userId).toBeNull();
    expect(
      directTransferRequest(text, [{ ...selected(text)[0], label: "@ana" }])
        ?.userId,
    ).toBeNull();
    expect(
      directTransferRequest(text, [{ ...selected(text)[0], start: 0 }])?.userId,
    ).toBeNull();
  });

  it.each([
    "What is my USDC balance?",
    "Can I afford to send 1 USDC to @juan?",
    "Don't send 1 USDC to @juan",
    'Explain "send 1 USDC to @juan"',
    "Send 1 USDC to @juan after swapping my XLM",
    "Send 1 USDC to @juan for the saved split request",
    "Send 1 USDC to @juan and @ana",
    "Swap 1 XLM for USDC",
  ])(
    "leaves non-standalone send instructions to the normal tools: %s",
    (text) => {
      expect(directTransferRequest(text, selected(text))).toBeNull();
    },
  );
});
import {
  validateTransferAuthorization,
  validateTransferEnvelope,
  type TransferIntent,
} from "../src/lib/smart-account/server/transfer-policy";
import { TESTNET } from "../src/lib/smart-account/shared";
import { transferFunction } from "../src/lib/smart-account/transfer";

const sender = StrKey.encodeContract(Buffer.alloc(32, 1));
const recipient = StrKey.encodeContract(Buffer.alloc(32, 2));
const other = StrKey.encodeContract(Buffer.alloc(32, 3));
const sponsor = Keypair.random().publicKey();
const intent: TransferIntent = {
  account: sender,
  recipient,
  token: TESTNET_ASSETS.USDC,
  units: "10000000",
};
const expires = 1_800_000_120_000;

function authorization(value = intent, signed = false) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(value.account).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 120,
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
          transferFunction(
            value.token,
            value.account,
            value.recipient,
            BigInt(value.units),
          ).invokeContract(),
        ),
      subInvocations: [],
    }),
  });
}

function envelope(
  options: {
    intent?: TransferIntent;
    auth?: xdr.SorobanAuthorizationEntry[];
    source?: string;
    opSource?: string;
    extra?: boolean;
    memo?: boolean;
    deadline?: number;
    fee?: string;
  } = {},
) {
  const value = options.intent ?? intent;
  const builder = new TransactionBuilder(
    new Account(options.source ?? sponsor, "10"),
    { fee: options.fee ?? "100", networkPassphrase: TESTNET.networkPassphrase },
  )
    .addOperation(
      Operation.invokeHostFunction({
        source: options.opSource,
        func: transferFunction(
          value.token,
          value.account,
          value.recipient,
          BigInt(value.units),
        ),
        auth: options.auth ?? [authorization(value, true)],
      }),
    )
    .setTimebounds(0, options.deadline ?? expires / 1000);
  if (options.extra)
    builder.addOperation(Operation.manageData({ name: "hidden", value: "1" }));
  if (options.memo) builder.addMemo(Memo.text("unreviewed"));
  return builder.build();
}

describe("integer friend transfer amounts", () => {
  it("uses Stellar USDC precision, never floating point or six-decimal units", () => {
    expect(parseAmount("1.0000001", "USDC")).toEqual({
      amount: "1.0000001",
      units: "10000001",
    });
    expect(parseAmount("900719925.4740993", "USDC").units).toBe(
      "9007199254740993",
    );
    expect(() =>
      assertTransferAmount({
        asset: "USDC",
        token: TESTNET_ASSETS.USDC,
        amount: "1",
        units: "1000000",
      }),
    ).toThrow();
    expect(() =>
      assertTransferAmount({
        asset: "USDC",
        token: TESTNET_ASSETS.XLM,
        amount: "1",
        units: "10000000",
      }),
    ).toThrow();
    for (const value of [
      "0",
      "-1",
      "1e7",
      "0.00000001",
      "1,000",
      "17014118346046923173168730371588.4105728",
    ])
      expect(() => parseAmount(value, "USDC")).toThrow();
  });
  it("distinguishes unavailable balance, exact coverage, and a one-unit shortfall", () => {
    expect(transferShortfall("10000000", null)).toBeNull();
    expect(transferShortfall("10000000", "9999999")).toBe("0.0000001");
    expect(transferShortfall("10000000", "10000000")).toBe("0");
    expect(transferShortfall("10000000", "10000001")).toBe("0");
  });
});

describe("complete reviewed transfer policy", () => {
  it.each([TESTNET_ASSETS.USDC, TESTNET_ASSETS.XLM])(
    "preserves exact sends of %s",
    (token) => {
      const value = { ...intent, token };
      const tx = envelope({ intent: value });
      expect(() =>
        validateTransferEnvelope(
          tx.toXDR(),
          tx.hash().toString("hex"),
          sponsor,
          value,
          authorization(value).toXDR("base64"),
          expires,
        ),
      ).not.toThrow();
    },
  );
  it("rejects changed sender, recipient, token, amount and hidden auth branches", () => {
    for (const change of [
      { account: other },
      { recipient: other },
      { token: TESTNET_ASSETS.XLM },
      { units: "10000001" },
    ])
      expect(() =>
        validateTransferAuthorization(
          authorization({ ...intent, ...change }),
          intent,
        ),
      ).toThrow();
    const entry = authorization();
    entry
      .rootInvocation()
      .subInvocations()
      .push(authorization().rootInvocation());
    expect(() => validateTransferAuthorization(entry, intent)).toThrow();
    entry.rootInvocation().subInvocations([]);
    entry.rootInvocation().function().contractFn().functionName("approve");
    expect(() => validateTransferAuthorization(entry, intent)).toThrow();
    const amount = authorization();
    amount.rootInvocation().function().contractFn().args()[2] = nativeToScVal(
      BigInt(-1),
      { type: "i128" },
    );
    expect(() => validateTransferAuthorization(amount, intent)).toThrow();
  });
  it("binds the signed entry to its nonce, expiry and signer, requiring authorization", () => {
    const unsigned = authorization().toXDR("base64");
    for (const change of [
      (entry: xdr.SorobanAuthorizationEntry) =>
        addressCredentials(entry).nonce(xdr.Int64.fromString("8")),
      (entry: xdr.SorobanAuthorizationEntry) =>
        addressCredentials(entry).signatureExpirationLedger(121),
      (entry: xdr.SorobanAuthorizationEntry) =>
        addressCredentials(entry).address(
          Address.fromString(other).toScAddress(),
        ),
    ]) {
      const entry = authorization(intent, true);
      change(entry);
      expect(() =>
        validateSignedAuthorization(unsigned, entry.toXDR("base64")),
      ).toThrow();
    }
    expect(() => validateSignedAuthorization(unsigned, unsigned)).toThrow(
      /missing/,
    );
  });
  it("rejects altered complete envelopes, even when the transfer function itself matches", () => {
    const changedNonce = authorization(intent, true);
    addressCredentials(changedNonce).nonce(xdr.Int64.fromString("99"));
    for (const tx of [
      envelope({ extra: true }),
      envelope({ memo: true }),
      envelope({ source: Keypair.random().publicKey() }),
      envelope({ opSource: Keypair.random().publicKey() }),
      envelope({ deadline: 0 }),
      envelope({ deadline: expires / 1000 + 1 }),
      envelope({ fee: "5000001" }),
      envelope({ auth: [] }),
      envelope({
        auth: [authorization(intent, true), authorization(intent, true)],
      }),
      envelope({ auth: [changedNonce] }),
      envelope({ intent: { ...intent, recipient: other } }),
    ])
      expect(() =>
        validateTransferEnvelope(
          tx.toXDR(),
          tx.hash().toString("hex"),
          sponsor,
          intent,
          authorization().toXDR("base64"),
          expires,
        ),
      ).toThrow();
    const tx = envelope();
    expect(() =>
      validateTransferEnvelope(
        tx.toXDR(),
        "0".repeat(64),
        sponsor,
        intent,
        authorization().toXDR("base64"),
        expires,
      ),
    ).toThrow();
  });
});
