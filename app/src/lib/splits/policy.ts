import { contractShares, displayAmount, NARU_SPLIT } from "@naru/backend/money";
import {
  Address,
  nativeToScVal,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { z } from "zod";

import {
  addressCredentials,
  validateSignedAuthorization,
} from "../smart-account/server/policy";
import { TESTNET } from "../smart-account/shared";

export type CreationIntent = {
  account: string;
  splitId: string;
  units: string;
  participants: string[];
};

export const creationReviewSchema = z.object({
  id: z.string(),
  auth: z.string(),
  expiration: z.number().int().positive(),
  expiresAt: z.number(),
});

export type CreationReview = z.infer<typeof creationReviewSchema>;

export function creationFunction(intent: CreationIntent) {
  if (
    !/^[0-9a-f]{64}$/.test(intent.splitId) ||
    !/^[1-9]\d{0,38}$/.test(intent.units) ||
    !intent.participants.includes(intent.account)
  )
    throw new Error("Invalid split creation terms.");

  const shares = contractShares(
    displayAmount(intent.units),
    intent.participants,
  );

  if (
    shares.some((share, index) => share.account !== intent.participants[index])
  )
    throw new Error(
      "Participants must use the reviewed canonical address order.",
    );

  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(NARU_SPLIT.contract).toScAddress(),
      functionName: "create",
      args: [
        Address.fromString(intent.account).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(intent.splitId, "hex")),
        nativeToScVal(BigInt(intent.units), { type: "i128" }),
        xdr.ScVal.scvVec(
          intent.participants.map((account) =>
            Address.fromString(account).toScVal(),
          ),
        ),
      ],
    }),
  );
}

export function validateCreationAuthorization(
  entry: xdr.SorobanAuthorizationEntry,
  intent: CreationIntent,
) {
  const root = entry.rootInvocation();

  if (
    Address.fromScAddress(addressCredentials(entry).address()).toString() !==
      intent.account ||
    root.subInvocations().length !== 0 ||
    root.function().switch().name !==
      "sorobanAuthorizedFunctionTypeContractFn" ||
    !root
      .function()
      .contractFn()
      .toXDR()
      .equals(creationFunction(intent).invokeContract().toXDR())
  )
    throw new Error(
      "Creation authorization changed the reviewed terms or contains unexpected calls. No transfers are allowed.",
    );
}

export function validateCreationEnvelope(
  envelope: string,
  hash: string | null,
  sponsor: string,
  intent: CreationIntent,
  reviewedAuth: string,
  expires: number,
) {
  const tx = TransactionBuilder.fromXDR(envelope, TESTNET.networkPassphrase);

  if (
    !(tx instanceof Transaction) ||
    tx.hash().toString("hex") !== hash ||
    tx.source !== sponsor ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "none" ||
    !tx.timeBounds ||
    tx.timeBounds.minTime !== "0" ||
    Number(tx.timeBounds.maxTime) <= 0 ||
    Number(tx.timeBounds.maxTime) > Math.floor(expires / 1000) ||
    BigInt(tx.fee) > BigInt(5_000_000)
  )
    throw new Error(
      "Transaction evidence does not match the reviewed creation.",
    );
  const op = tx.operations[0];

  if (
    op.type !== "invokeHostFunction" ||
    (op.source !== undefined && op.source !== sponsor) ||
    !op.func.toXDR().equals(creationFunction(intent).toXDR()) ||
    op.auth?.length !== 1
  )
    throw new Error("Only the exact NaruSplit creation invocation is allowed.");
  validateCreationAuthorization(op.auth[0], intent);
  validateSignedAuthorization(reviewedAuth, op.auth[0].toXDR("base64"));
  validateSplitRestoration(tx, intent);
}

export function splitStorageKey(
  intent: Pick<CreationIntent, "account" | "splitId">,
) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(NARU_SPLIT.contract).toScAddress(),
      durability: xdr.ContractDataDurability.persistent(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Split"),
        Address.fromString(intent.account).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(intent.splitId, "hex")),
      ]),
    }),
  );
}

export function maintenanceFunction(intent: CreationIntent) {
  creationFunction(intent); // Same validated identity and immutable terms.

  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(NARU_SPLIT.contract).toScAddress(),
      functionName: "keep_alive",
      args: [
        Address.fromString(intent.account).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(intent.splitId, "hex")),
      ],
    }),
  );
}

function validateSplitRestoration(tx: Transaction, intent: CreationIntent) {
  const ext = tx.toEnvelope().v1().tx().ext();

  if (ext.switch() !== 1) return;
  const data = ext.sorobanData();

  if (data.ext().switch() !== 1) return;
  const allowed = splitStorageKey(intent).toXDR();
  const keys = data.resources().footprint().readWrite();

  for (const index of data.ext().resourceExt().archivedSorobanEntries()) {
    if (!keys[index]?.toXDR().equals(allowed))
      throw new Error(
        "Shared infrastructure or account restoration requires separate maintenance.",
      );
  }
}

export function validateMaintenanceEnvelope(
  envelope: string,
  hash: string | null,
  sponsor: string,
  intent: CreationIntent,
  expires: number,
) {
  const tx = TransactionBuilder.fromXDR(envelope, TESTNET.networkPassphrase);

  if (
    !(tx instanceof Transaction) ||
    tx.hash().toString("hex") !== hash ||
    tx.source !== sponsor ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "none" ||
    !tx.timeBounds ||
    tx.timeBounds.minTime !== "0" ||
    Number(tx.timeBounds.maxTime) <= 0 ||
    Number(tx.timeBounds.maxTime) > Math.floor(expires / 1000) ||
    BigInt(tx.fee) > BigInt(5_000_000)
  )
    throw new Error("Invalid split maintenance envelope.");
  const op = tx.operations[0];

  if (
    op.type !== "invokeHostFunction" ||
    (op.source !== undefined && op.source !== sponsor) ||
    !op.func.toXDR().equals(maintenanceFunction(intent).toXDR()) ||
    op.auth?.length !== 0
  )
    throw new Error(
      "Only this split's permissionless keep_alive is allowed; no user authorization or transfers.",
    );
  validateSplitRestoration(tx, intent);
}

export const createdSplitSchema = z.object({
  recipient: z.string(),
  total: z.bigint(),
  created_ledger: z.number().int().positive(),
  shares: z.array(
    z.object({
      participant: z.string(),
      amount: z.bigint(),
      state: z.union([
        z.tuple([z.literal("Organizer")]),
        z.tuple([z.literal("Outstanding")]),
        z.tuple([z.enum(["Paid", "Cancelled"]), z.number().int().positive()]),
      ]),
    }),
  ),
});

type CreatedSplit = z.infer<typeof createdSplitSchema>;

// Compare every field used for publication, not just existence of an ID.
export function parseCreatedSplit(state: CreatedSplit, intent: CreationIntent) {
  const expected = contractShares(
    displayAmount(intent.units),
    intent.participants,
  );

  if (
    state.recipient !== intent.account ||
    state.total.toString() !== intent.units ||
    state.shares.length !== expected.length ||
    state.shares.some(
      (share, i) =>
        share.participant !== expected[i].account ||
        share.amount.toString() !== expected[i].units ||
        (share.participant === intent.account
          ? share.state[0] !== "Organizer"
          : share.state[0] === "Organizer"),
    )
  )
    throw new Error(
      "On-chain split terms do not match the authorized review. Requests were not delivered.",
    );

  return state;
}
