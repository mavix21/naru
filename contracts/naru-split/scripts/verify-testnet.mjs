import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../app/package.json", import.meta.url),
);

const {
  Address,
  Contract,
  Networks,
  rpc,
  TransactionBuilder,
  scValToNative,
  xdr,
} = require("@stellar/stellar-sdk");

const deployment = JSON.parse(
  await readFile(
    new URL("../deployments/testnet.json", import.meta.url),
    "utf8",
  ),
);

const { publication, benchmark } = deployment;

const wasm = await readFile(
  new URL(
    "../../../target/wasm32v1-none/release/naru_split.wasm",
    import.meta.url,
  ),
);

assert.equal(
  createHash("sha256").update(wasm).digest("hex"),
  deployment.wasmSha256,
);

assert.equal(benchmark.sponsorCapStroops, "5000000");

assert.deepEqual(
  benchmark.results.map((r) => r.participants),
  Array.from({ length: 12 }, (_, i) => i + 2),
);

assert.ok(
  benchmark.results.every((r) => BigInt(r.estimatedFeeStroops) <= 5_000_000n),
);

const server = new rpc.Server(deployment.rpcUrl);

assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);

const instance = await server.getContractData(
  deployment.contractId,
  xdr.ScVal.scvLedgerKeyContractInstance(),
);

assert.equal(
  instance.val
    .contractData()
    .val()
    .instance()
    .executable()
    .wasmHash()
    .toString("hex"),
  deployment.wasmSha256,
);

const operatorReceipts = [];

for (const [name, saved] of Object.entries(deployment.transactions)) {
  const receipt = await server.getTransaction(saved.hash);
  assert.equal(
    receipt.status,
    "SUCCESS",
    `${name}: receipt unavailable or failed`,
  );
  assert.equal(receipt.ledger, saved.ledger);
  assert.equal(
    TransactionBuilder.fromXDR(receipt.envelopeXdr, Networks.TESTNET).source,
    deployment.operator,
  );
  assert.equal(
    receipt.resultXdr.feeCharged().toString(),
    saved.actualFeeStroops,
  );
  operatorReceipts.push({
    name,
    hash: saved.hash,
    actualFeeStroops: saved.actualFeeStroops,
  });
}

const receipt = await server.getTransaction(publication.creationHash);

assert.equal(receipt.status, "SUCCESS");

assert.equal(receipt.ledger, publication.ledger);

assert.equal(
  receipt.resultXdr.feeCharged().toString(),
  publication.actualFeeStroops,
);

const tx = TransactionBuilder.fromXDR(receipt.envelopeXdr, Networks.TESTNET);

assert.notEqual(
  tx.source,
  deployment.operator,
  "Application sponsor and deployment operator must be separate",
);

assert.equal(tx.fee, publication.estimatedFeeStroops);

assert.ok(BigInt(tx.fee) <= 5_000_000n);

assert.equal(tx.operations.length, 1);

const op = tx.operations[0];

assert.equal(op.type, "invokeHostFunction");

assert.equal(op.auth.length, 1);

assert.equal(op.auth[0].rootInvocation().subInvocations().length, 0);

assert.ok(
  op.auth[0]
    .rootInvocation()
    .function()
    .contractFn()
    .toXDR()
    .equals(op.func.invokeContract().toXDR()),
);

assert.equal(
  Address.fromScAddress(op.func.invokeContract().contractAddress()).toString(),
  deployment.contractId,
);

assert.equal(op.func.invokeContract().functionName().toString(), "create");

const [organizer, id, total, participants] = op.func
  .invokeContract()
  .args()
  .map(scValToNative);

assert.equal(organizer, publication.organizer);

assert.equal(id.toString("hex"), publication.splitId);

assert.equal(total.toString(), publication.totalUsdcUnits);

assert.deepEqual(
  participants,
  publication.shares.map((s) => s.account),
);

const source = await server.getAccount(tx.source);

const args = [Address.fromString(organizer).toScVal(), xdr.ScVal.scvBytes(id)];

const getTx = new TransactionBuilder(source, {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(new Contract(deployment.contractId).call("get", ...args))
  .setTimeout(60)
  .build();

const get = await server.simulateTransaction(getTx);

assert.ok(rpc.Api.isSimulationSuccess(get));

assert.equal(
  get.stateChanges?.length ?? 0,
  0,
  "get must not write or renew storage",
);

const split = scValToNative(get.result.retval);

assert.equal(split.recipient, organizer);

assert.equal(split.total.toString(), publication.totalUsdcUnits);

assert.equal(split.created_ledger, publication.ledger);

assert.deepEqual(
  split.shares.map((s) => ({
    account: s.participant,
    units: s.amount.toString(),
  })),
  publication.shares,
);

assert.deepEqual(
  split.shares.map((s) => s.state[0]),
  publication.shares.map((s) =>
    s.account === organizer ? "Organizer" : "Outstanding",
  ),
);

const key = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: Address.fromString(deployment.contractId).toScAddress(),
    durability: xdr.ContractDataDurability.persistent(),
    key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Split"), ...args]),
  }),
);

const entry = await server.getLedgerEntries(key);

assert.equal(entry.entries.length, 1);

assert.equal(
  entry.entries[0].val.toXDR().length + 8,
  benchmark.results.find((r) => r.participants === 3).splitEntryBytes,
);

const report = {
  verifiedAt: new Date().toISOString(),
  contractId: deployment.contractId,
  creationHash: publication.creationHash,
  sponsor: tx.source,
  actualCreationFeeXlm: Number(publication.actualFeeStroops) / 1e7,
  splitEntryBytes: entry.entries[0].val.toXDR().length + 8,
  splitLiveUntilLedger: entry.entries[0].liveUntilLedgerSeq,
  operatorReceipts,
  benchmarkCounts: benchmark.results.length,
  sponsorCapStroops: "5000000",
};

console.log(JSON.stringify(report, null, 2));
