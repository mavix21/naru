// Read-only deployment verification. Reuses the repository's installed SDK.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../app/package.json", import.meta.url));

const { Address, Asset, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } =
  require("@stellar/stellar-sdk");

const evidence = JSON.parse(await readFile(new URL("../deployments/testnet.json", import.meta.url), "utf8"));

const wasm = await readFile(new URL("../../../target/wasm32v1-none/release/naru_split.wasm", import.meta.url));

assert.equal(createHash("sha256").update(wasm).digest("hex"), evidence.wasmSha256, "local build differs from deployment");

assert.equal(evidence.network, Networks.TESTNET);

assert.equal(evidence.rpcUrl, "https://soroban-testnet.stellar.org");

assert.equal(new Asset("USDC", evidence.usdc.issuer).contractId(Networks.TESTNET), evidence.usdc.contractId);

async function rpcCall(method, params = {}) {
  const response = await fetch(evidence.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);

  const body = await response.json();

  if (body.error) throw new Error(JSON.stringify(body.error));

  return body.result;
}

const network = await rpcCall("getNetwork");

assert.equal(network.passphrase, Networks.TESTNET);

const server = new rpc.Server(evidence.rpcUrl);

const contract = new Contract(evidence.contractId);

const deployed = await server.getLedgerEntries(contract.getFootprint());

assert.equal(deployed.entries.length, 1, "contract instance unavailable (check archival or Testnet reset)");

assert.equal(deployed.entries[0].val.contractData().val().instance().executable().wasmHash().toString("hex"), evidence.wasmSha256);

const transactions = await Promise.all(Object.entries(evidence.transactions).map(async ([name, expected]) => {
  const result = await rpcCall("getTransaction", { hash: expected.hash });

  assert.equal(result.status, "SUCCESS", `${name}: unavailable or unsuccessful; RPC history retention is finite`);

  assert.equal(result.ledger, expected.ledger, `${name}: ledger mismatch`);

  return { name, ...result };
}));

const payment = TransactionBuilder.fromXDR(transactions.find(t => t.name === "pay").envelopeXdr, Networks.TESTNET);

assert.equal(payment.source, evidence.accounts.alice);

assert.equal(payment.operations.length, 1);

const operation = payment.operations[0];

assert.equal(operation.type, "invokeHostFunction");

assert.equal(operation.auth.length, 1);

assert.equal(operation.auth[0].credentials().switch().name, evidence.paymentAuth.credentials);

// Decode the SDK's parsed XDR discriminants into the evidence's JSON format.
function decoded(value) {
  switch (value.switch().name) {
    case "scvI128":
      return scValToNative(value).toString();
    case "scvBytes":
      return value.bytes().toString("hex");
    case "scvVec":
      return value.vec().map(decoded);
    case "scvMap":
      return Object.fromEntries(value.map().map(entry => [decoded(entry.key()), decoded(entry.val())]));
    default:
      return scValToNative(value);
  }
}

function invocation(value) {
  const fn = value.function().contractFn();

  return {
    contract: Address.fromScAddress(fn.contractAddress()).toString(),
    method: fn.functionName().toString(),
    args: fn.args().map(decoded),
    children: value.subInvocations().map(invocation),
  };
}

const authTree = invocation(operation.auth[0].rootInvocation());

assert.deepEqual(authTree, {
  contract: evidence.contractId,
  method: "pay",
  args: [evidence.accounts.organizer, evidence.splitId, evidence.accounts.alice],
  children: [{
    contract: evidence.usdc.contractId,
    method: "transfer",
    args: [evidence.accounts.alice, evidence.accounts.organizer, "1000000"],
    children: [],
  }],
});

const source = await server.getAccount(evidence.accounts.organizer);

async function read(contractId, method, ...args) {
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new Error(`${method}: ${simulation.error ?? "simulation failed"}`);
  }

  return decoded(simulation.result.retval);
}

const address = value => new Address(value).toScVal();

const state = await read(evidence.contractId, "get", address(evidence.accounts.organizer), nativeToScVal(Buffer.from(evidence.splitId, "hex")));

assert.deepEqual(state, {
  created_ledger: evidence.transactions.create.ledger,
  recipient: evidence.accounts.organizer,
  total: evidence.totalUnits,
  shares: evidence.shares.map(share => ({
    participant: evidence.accounts[share.account],
    amount: share.units,
    state: share.ledger ? [share.state, share.ledger] : [share.state],
  })),
});

assert.equal(await read(evidence.contractId, "usdc"), evidence.usdc.contractId);

assert.equal(await read(evidence.usdc.contractId, "decimals"), evidence.usdc.decimals);

const balances = {};

for (const [name, expected] of Object.entries(evidence.balancesInUsdcUnits.afterSmoke)) {
  const account = name === "contract" ? evidence.contractId : evidence.accounts[name];

  balances[name] = await read(evidence.usdc.contractId, "balance", address(account));

  assert.equal(balances[name], expected, `${name}: balance has changed since smoke test`);
}

console.log(JSON.stringify({
  verifiedAt: new Date().toISOString(),
  contractId: evidence.contractId,
  wasmSha256: evidence.wasmSha256,
  protocolVersion: network.protocolVersion,
  transactions: transactions.map(({ name, status, ledger }) => ({ name, status, ledger })),
  authTree,
  state,
  balances,
  smartAccountPasskeyValidated: false,
}, null, 2));
