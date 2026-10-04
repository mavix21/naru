import "server-only";
import {
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import { TESTNET } from "../shared";

export const stellarRpc = new rpc.Server(TESTNET.rpcUrl, { timeout: 20_000 });

export async function readContractSnapshot(
  source: string,
  contract: string,
  method: string,
  args: xdr.ScVal[] = [],
) {
  const transaction = new TransactionBuilder(
    await stellarRpc.getAccount(source),
    {
      fee: BASE_FEE,
      networkPassphrase: TESTNET.networkPassphrase,
    },
  )
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(60)
    .build();

  const simulation = await stellarRpc.simulateTransaction(transaction);

  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result)
    throw new Error("Testnet contract data is unavailable. Please try again.");

  return {
    value: scValToNative(simulation.result.retval),
    ledger: simulation.latestLedger,
  };
}

export async function readContract(
  source: string,
  contract: string,
  method: string,
  args: xdr.ScVal[] = [],
) {
  return (await readContractSnapshot(source, contract, method, args)).value;
}
