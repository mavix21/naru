// Separate operator-funded deployment/shared-code maintenance. Never uses the
// app sponsor secret or its journal. Every transaction is simulated before send.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../app/package.json", import.meta.url),
);

const {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  rpc,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  hash,
  xdr,
} = require("@stellar/stellar-sdk");

const apply = process.argv.includes("--apply");

const maintain = process.argv.includes("--maintain");

const config = process.env.NARU_SPLIT_OPERATOR_CONFIG;

const identity = process.env.NARU_SPLIT_OPERATOR_IDENTITY;

const journalPath = process.env.NARU_SPLIT_OPERATOR_JOURNAL;

const output = process.env.NARU_SPLIT_OPERATOR_OUTPUT;

const budget = process.env.NARU_SPLIT_OPERATOR_BUDGET_STROOPS;

if (
  !config ||
  !identity ||
  !journalPath ||
  !output ||
  !/^[1-9]\d*$/.test(budget ?? "")
)
  throw new Error(
    "Set explicit operator config, identity, journal, evidence output, and operator budget in stroops. Default is simulation-only; --apply sends.",
  );

const operator = Keypair.fromSecret(
  execFileSync(
    "stellar",
    ["--config-dir", config, "keys", "secret", identity],
    { encoding: "utf8" },
  ).trim(),
);

if (
  !StrKey.isValidEd25519PublicKey(
    process.env.NARU_SMART_ACCOUNT_SPONSOR_ADDRESS ?? "",
  )
)
  throw new Error(
    "Provide the application sponsor's public address so operator/account separation can be verified.",
  );

if (operator.publicKey() === process.env.NARU_SMART_ACCOUNT_SPONSOR_ADDRESS)
  throw new Error(
    "Use a separate infrastructure operator, not the application sponsor.",
  );

const wasm = await readFile(
  new URL(
    "../../../target/wasm32v1-none/release/naru_split.wasm",
    import.meta.url,
  ),
);

const wasmSha256 = createHash("sha256").update(wasm).digest("hex");

const server = new rpc.Server("https://soroban-testnet.stellar.org");

assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);

const journal = await readFile(journalPath, "utf8")
  .then(JSON.parse)
  .catch(() => ({ salt: randomBytes(32).toString("hex"), transactions: {} }));

if (journal.wasmSha256 && journal.wasmSha256 !== wasmSha256)
  throw new Error("This journal belongs to a different build.");

journal.wasmSha256 = wasmSha256;

const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
  new xdr.ContractIdPreimageFromAddress({
    address: Address.fromString(operator.publicKey()).toScAddress(),
    salt: Buffer.from(journal.salt, "hex"),
  }),
);

const contractId = StrKey.encodeContract(
  hash(
    xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        contractIdPreimage: preimage,
      }),
    ).toXDR(),
  ),
);

const persist = () =>
  writeFile(journalPath, JSON.stringify(journal), { mode: 0o600 });

const codeKey = xdr.LedgerKey.contractCode(
  new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmSha256, "hex") }),
);

const instanceKey = new Contract(contractId).getFootprint();

async function submit(name, operation, data) {
  let saved = journal.transactions[name];

  if (!saved) {
    const builder = new TransactionBuilder(
      await server.getAccount(operator.publicKey()),
      { fee: "100", networkPassphrase: Networks.TESTNET },
    )
      .addOperation(operation)
      .setTimeout(180);

    if (data) builder.setSorobanData(data);
    const tx = builder.build();
    const simulation = await server.simulateTransaction(tx);

    if (
      !rpc.Api.isSimulationSuccess(simulation) ||
      rpc.Api.isSimulationRestore(simulation)
    )
      throw new Error(
        simulation.error ?? `${name}: explicit restoration is required`,
      );
    const prepared = rpc.assembleTransaction(tx, simulation).build();
    console.log({
      operation: name,
      source: "separate Testnet infrastructure operator",
      estimatedFeeStroops: prepared.fee,
      estimatedFeeXlm: Number(prepared.fee) / 1e7,
      willSend: apply,
    });

    if (BigInt(prepared.fee) > BigInt(budget))
      throw new Error(
        "Measured operator fee exceeds the explicitly supplied operator budget. Nothing sent.",
      );

    if (!apply) return false;
    prepared.sign(operator);
    saved = {
      hash: prepared.hash().toString("hex"),
      envelope: prepared.toXDR(),
      estimatedFeeStroops: prepared.fee,
    };
    journal.transactions[name] = saved;
    await persist();
  }

  for (let attempt = 0; attempt < 45; attempt++) {
    const receipt = await server.getTransaction(saved.hash);

    if (receipt.status === "SUCCESS") {
      const meta = receipt.resultMetaXdr.value().sorobanMeta();
      const fee = meta?.ext().switch() === 1 ? meta.ext().v1() : null;
      Object.assign(saved, {
        status: "SUCCESS",
        ledger: receipt.ledger,
        actualFeeStroops: receipt.resultXdr.feeCharged().toString(),
        rentFeeStroops: fee?.rentFeeCharged().toString(),
      });
      await persist();
      console.log({
        operation: name,
        hash: saved.hash,
        ledger: saved.ledger,
        actualFeeStroops: saved.actualFeeStroops,
        rentFeeStroops: saved.rentFeeStroops,
      });

      return true;
    }

    if (receipt.status === "FAILED")
      throw new Error(`${name} failed: ${saved.hash}`);
    const tx = TransactionBuilder.fromXDR(saved.envelope, Networks.TESTNET);

    if (Number(tx.timeBounds.maxTime) * 1000 <= Date.now())
      throw new Error(
        `Unknown outcome; reconcile ${saved.hash} before retrying.`,
      );

    if (attempt === 0) await server.sendTransaction(tx);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Still pending: ${saved.hash}`);
}

if (!maintain) {
  if (!(await submit("upload", Operation.uploadContractWasm({ wasm }))))
    process.exit(0);

  if (
    !(await submit(
      "deploy",
      Operation.createCustomContract({
        address: Address.fromString(operator.publicKey()),
        wasmHash: Buffer.from(wasmSha256, "hex"),
        salt: Buffer.from(journal.salt, "hex"),
        constructorArgs: [],
      }),
    ))
  )
    process.exit(0);
}

let entries = await server.getLedgerEntries(instanceKey, codeKey);

if (entries.entries.length !== 2 && maintain) {
  const missing = [instanceKey, codeKey].filter(
    (key) => !entries.entries.some((e) => e.key.toXDR().equals(key.toXDR())),
  );

  const restored = await submit(
    `restore-infrastructure:${Math.floor(entries.latestLedger / 17280)}`,
    Operation.restoreFootprint({}),
    new SorobanDataBuilder().setReadWrite(missing).build(),
  );

  if (!restored) process.exit(0);
  entries = await server.getLedgerEntries(instanceKey, codeKey);
}

assert.equal(
  entries.entries.length,
  2,
  "Infrastructure is not live; run operator --maintain restoration before serving requests.",
);

assert.equal(
  entries.entries
    .find((e) => e.key.switch().name === "contractData")
    .val.contractData()
    .val()
    .instance()
    .executable()
    .wasmHash()
    .toString("hex"),
  wasmSha256,
);

const ttls = entries.entries.map((e) => ({
  kind: e.key.switch().name,
  liveUntilLedger: e.liveUntilLedgerSeq,
  remainingLedgers: e.liveUntilLedgerSeq - entries.latestLedger,
}));

console.log({ contractId, wasmSha256, ttl: ttls });

// A separate operator renews both infrastructure entries when either has <7d.
// It is never appended to a user's creation, payment, or split keep-alive call.
if (maintain && ttls.some((e) => e.remainingLedgers < 7 * 17280)) {
  await submit(
    `infrastructure:${Math.min(...ttls.map((e) => e.liveUntilLedger))}`,
    Operation.extendFootprintTtl({ extendTo: 30 * 17280 }),
    new SorobanDataBuilder().setReadOnly([instanceKey, codeKey]).build(),
  );
}

const evidence = {
  version: "0.2.0",
  verifiedAt: new Date().toISOString(),
  network: Networks.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId,
  wasmSha256,
  wasmBytes: wasm.length,
  operator: operator.publicKey(),
  splitTtlLedgers: 30 * 17280,
  splitRenewalThresholdLedgers: 7 * 17280,
  infrastructureManagedSeparately: true,
  transactions: Object.fromEntries(
    Object.entries(journal.transactions).map(
      ([name, { envelope: _, ...receipt }]) => [name, receipt],
    ),
  ),
};

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
