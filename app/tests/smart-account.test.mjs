import {
  Address,
  Asset,
  Contract,
  hash,
  Keypair,
  Networks,
  Operation,
  StrKey,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWebAuthnSigner, signerToScVal } from "smart-account-kit";

import { gateStatus } from "../src/lib/smart-account/gate.ts";
import { buildFundingTransfer } from "../src/lib/smart-account/server/funding.ts";
import {
  addressCredentials,
  validateDeployment,
  validateSignedAuthorization,
} from "../src/lib/smart-account/server/policy.ts";
import { SponsorStore } from "../src/lib/smart-account/server/store.ts";
import { TESTNET } from "../src/lib/smart-account/shared.ts";
import { validateTransferReview } from "../src/lib/smart-account/transfer.ts";

function deploymentFixture() {
  const credential = Buffer.alloc(32, 7);

  // Public P-256 generator point; fixture only, no user's passkey/private key.
  const publicKey = Buffer.from(
    "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    "hex",
  );

  const deployer = Keypair.fromRawEd25519Seed(
    hash(Buffer.from("openzeppelin-smart-account-kit")),
  ).publicKey();

  const signer = createWebAuthnSigner(
    TESTNET.webauthnVerifierAddress,
    publicKey,
    credential,
  );

  const op = Operation.createCustomContract({
    address: Address.fromString(deployer),
    wasmHash: Buffer.from(TESTNET.accountWasmHash, "hex"),
    salt: hash(credential),
    constructorArgs: [
      xdr.ScVal.scvVec([signerToScVal(signer)]),
      xdr.ScVal.scvMap([]),
    ],
  });

  const func = op.body().invokeHostFunctionOp().hostFunction();
  const preimage = func.createContractV2().contractIdPreimage();

  const account = StrKey.encodeContract(
    hash(
      xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId: hash(Buffer.from(Networks.TESTNET)),
          contractIdPreimage: preimage,
        }),
      ).toXDR(),
    ),
  );

  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(deployer).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
          func.createContractV2(),
        ),
      subInvocations: [],
    }),
  });

  return {
    func,
    auth,
    account,
    credentialId: credential.toString("base64url"),
    publicKey,
  };
}

function validate(fixture) {
  return validateDeployment(
    fixture.func,
    [fixture.auth],
    fixture.account,
    fixture.credentialId,
    fixture.publicKey,
    TESTNET,
  );
}

test("accepts kit-shaped deployment; rejects changed code, verifier, policies, salt, account, and nested auth", () => {
  validate(deploymentFixture());

  const mutations = [
    (f) =>
      f.func
        .createContractV2()
        .executable(
          xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
        ),
    (f) =>
      (f.func.createContractV2().constructorArgs()[0].vec()[0].vec()[1] =
        Address.fromString(f.account).toScVal()),
    (f) =>
      (f.func.createContractV2().constructorArgs()[1] = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: Address.fromString(f.account).toScVal(),
          val: xdr.ScVal.scvVoid(),
        }),
      ])),
    (f) =>
      f.func
        .createContractV2()
        .contractIdPreimage()
        .fromAddress()
        .salt(Buffer.alloc(32)),
    (f) => {
      f.account = StrKey.encodeContract(Buffer.alloc(32));
    },
    (f) =>
      f.auth
        .rootInvocation()
        .subInvocations([
          xdr.SorobanAuthorizedInvocation.fromXDR(
            f.auth.rootInvocation().toXDR(),
          ),
        ]),
    (f) =>
      f.auth.credentials(
        xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      ),
  ];

  for (const [index, mutate] of mutations.entries()) {
    const fixture = deploymentFixture();
    mutate(fixture);
    assert.throws(
      () => validate(fixture),
      `Deployment mutation ${index} must be rejected`,
    );
  }
});

function transferFixture() {
  const account = StrKey.encodeContract(Buffer.alloc(32, 1));
  const recipient = Keypair.random().publicKey();
  const token = new Contract(Asset.native().contractId(Networks.TESTNET));

  const invocation = token
    .call(
      "transfer",
      Address.fromString(account).toScVal(),
      Address.fromString(recipient).toScVal(),
      nativeToScVal(1_000_000n, { type: "i128" }),
    )
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(account).toScAddress(),
        nonce: xdr.Int64.fromString("123"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          invocation,
        ),
      subInvocations: [],
    }),
  });
}

test("review binding allows only signature changes and rejects missing signatures or altered transaction intent", () => {
  const entry = transferFixture();
  const expected = entry.toXDR("base64");
  assert.throws(
    () => validateSignedAuthorization(expected, expected),
    /missing/,
  );
  // Structural boundary test only. Cryptographic validity is enforced by RPC,
  // not this fixture signature; this test does not claim an on-chain transfer.
  addressCredentials(entry).signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("fixture"),
        val: xdr.ScVal.scvBytes(Buffer.alloc(64)),
      }),
    ]),
  );
  validateSignedAuthorization(expected, entry.toXDR("base64"));

  const mutations = [
    (e) => addressCredentials(e).nonce(xdr.Int64.fromString("999")),
    (e) => addressCredentials(e).signatureExpirationLedger(101),
    (e) =>
      addressCredentials(e).address(
        Address.fromString(Keypair.random().publicKey()).toScAddress(),
      ),
    (e) => e.rootInvocation().function().contractFn().functionName("approve"),
    (e) =>
      (e.rootInvocation().function().contractFn().args()[1] =
        Address.fromString(Keypair.random().publicKey()).toScVal()),
    (e) =>
      (e.rootInvocation().function().contractFn().args()[2] = nativeToScVal(
        2_000_000n,
        { type: "i128" },
      )),
    (e) =>
      e
        .rootInvocation()
        .subInvocations([
          xdr.SorobanAuthorizedInvocation.fromXDR(e.rootInvocation().toXDR()),
        ]),
  ];

  for (const mutate of mutations) {
    const changed = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    mutate(changed);
    assert.throws(
      () => validateSignedAuthorization(expected, changed.toXDR("base64")),
      /changed/,
    );
  }
});

test("browser review rejects authorization for a different visible recipient, amount, or nested call", () => {
  const entry = transferFixture();
  const args = entry.rootInvocation().function().contractFn();
  const account = Address.fromScVal(args.args()[0]).toString();
  const recipient = Address.fromScVal(args.args()[1]).toString();
  const token = Address.fromScAddress(args.contractAddress()).toString();
  validateTransferReview(entry, account, recipient, token, 100);
  assert.throws(
    () =>
      validateTransferReview(
        entry,
        account,
        Keypair.random().publicKey(),
        token,
        100,
      ),
    /displayed/,
  );
  args.args()[2] = nativeToScVal(5_000_000n, { type: "i128" });
  assert.throws(
    () => validateTransferReview(entry, account, recipient, token, 100),
    /displayed/,
  );
  args.args()[2] = nativeToScVal(1_000_000n, { type: "i128" });
  entry
    .rootInvocation()
    .subInvocations([
      xdr.SorobanAuthorizedInvocation.fromXDR(entry.rootInvocation().toXDR()),
    ]);
  assert.throws(
    () => validateTransferReview(entry, account, recipient, token, 100),
    /displayed/,
  );
});

test("funding authorizes only the sponsor's exact five-XLM transfer with source-account credentials", () => {
  const sponsor = Keypair.random().publicKey();
  const account = StrKey.encodeContract(Buffer.alloc(32, 2));
  const token = Asset.native().contractId(Networks.TESTNET);
  const { func, auth } = buildFundingTransfer(token, sponsor, account);

  // Empty auth was the regression: enforce-mode simulation rejects it even
  // though the funding address is also the transaction source and fee payer.
  assert.equal(auth.length, 1);
  assert.equal(
    auth[0].credentials().switch().name,
    "sorobanCredentialsSourceAccount",
  );
  const root = auth[0].rootInvocation();
  const invocation = root.function().contractFn();
  assert.equal(
    Address.fromScAddress(invocation.contractAddress()).toString(),
    token,
  );
  assert.equal(invocation.functionName().toString(), "transfer");
  assert.deepEqual(
    invocation.args().map((arg) => scValToNative(arg)),
    [sponsor, account, 50_000_000n],
  );
  assert.deepEqual(root.subInvocations(), []);
  assert.deepEqual(invocation.toXDR(), func.invokeContract().toXDR());
});

test("a failed funding simulation can be retried for the same account without removing its history", () => {
  const store = new SponsorStore(":memory:");

  try {
    store.insert(
      "rejected",
      "same-wallet",
      "fund",
      "func",
      "[]",
      Date.now() + 60_000,
    );
    store.claim("rejected");
    store.finish("rejected", "failed", null, "Testnet simulation rejected");
    store.insert(
      "retry",
      "same-wallet",
      "fund",
      "func",
      "source-auth",
      Date.now() + 60_000,
    );
    assert.equal(store.claim("retry"), true);
    assert.equal(store.get("rejected").hash, null);
    assert.deepEqual(
      store
        .accountJobs("same-wallet")
        .map(({ id }) => id)
        .sort(),
      ["rejected", "retry"],
    );
    store.pending("retry", "retry-hash", "retry-envelope");
    store.finish("retry", "confirmed", 123, null);
    assert.throws(() =>
      store.insert(
        "duplicate",
        "same-wallet",
        "fund",
        "func",
        "source-auth",
        Date.now() + 60_000,
      ),
    );
  } finally {
    store.close();
  }
});

test("durable reservations prevent duplicate signing, concurrent sources, and repeated grants across restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "naru-sponsor-test-"));
  const path = join(directory, "state.sqlite");
  let first = new SponsorStore(path);
  const second = new SponsorStore(path);

  try {
    first.insert("a", "wallet-a", "fund", "func", "[]", Date.now() + 60_000);
    assert.throws(() =>
      second.insert(
        "duplicate",
        "wallet-a",
        "fund",
        "func",
        "[]",
        Date.now() + 60_000,
      ),
    );
    first.claim("a");
    assert.equal(second.claim("a"), false);
    second.insert(
      "b",
      "wallet-b",
      "transfer",
      "func",
      "auth",
      Date.now() + 60_000,
    );
    assert.throws(() => second.claim("b"), /unresolved/);
    first.pending("a", "hash-a", "exact-signed-envelope");
    first.close();
    first = new SponsorStore(path);
    assert.equal(first.claim("a"), false);
    assert.equal(first.get("a").envelope, "exact-signed-envelope");
    first.finish("a", "confirmed", 123, null);
    assert.throws(() =>
      second.insert(
        "again",
        "wallet-a",
        "fund",
        "func",
        "[]",
        Date.now() + 60_000,
      ),
    );
    assert.equal(second.claim("b"), true);
    first.insert(
      "expired",
      "wallet-c",
      "transfer",
      "func",
      "auth",
      Date.now() - 1,
    );
    assert.throws(() => first.claim("expired"), /expired/);
    first.rate("daily-test", 1);
    assert.throws(() => second.rate("daily-test", 1), /budget/);
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true });
  }
});

test("nonlocal gates fail closed; fixed host and explicit HTTPS access token are required", () => {
  const settings = {
    development: false,
    enabled: false,
    origin: "https://naru.example",
    token: "x".repeat(32),
  };

  const headers = new Headers({ host: "naru.example" });
  assert.equal(gateStatus(headers, settings), 404);
  settings.enabled = true;
  assert.equal(gateStatus(headers, settings), 401);
  headers.set(
    "authorization",
    `Basic ${Buffer.from(`naru:${settings.token}`).toString("base64")}`,
  );
  assert.equal(gateStatus(headers, settings), 200);
  headers.set("host", "random-preview.example");
  assert.equal(gateStatus(headers, settings), 404);
  assert.equal(
    gateStatus(new Headers({ host: "localhost:3000" }), {
      ...settings,
      development: true,
      origin: "http://localhost:3000",
    }),
    200,
  );
  assert.equal(
    gateStatus(new Headers({ host: "localhost:3000" }), {
      ...settings,
      development: false,
      origin: "http://localhost:3000",
    }),
    404,
  );
});
