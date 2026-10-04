import { TESTNET_ASSETS } from "@naru/backend/money";
import { Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

import { TESTNET } from "../shared";
import { transferFunction, validateTransferReview } from "../transfer";
import { addressCredentials, validateSignedAuthorization } from "./policy";

export type TransferIntent = {
  account: string;
  recipient: string;
  token: string;
  units: string;
};

export function validateTransferAuthorization(
  entry: xdr.SorobanAuthorizationEntry,
  intent: TransferIntent,
) {
  if (
    (intent.token !== TESTNET_ASSETS.XLM &&
      intent.token !== TESTNET_ASSETS.USDC) ||
    !/^[1-9]\d{0,38}$/.test(intent.units) ||
    BigInt(intent.units) > (BigInt(1) << BigInt(127)) - BigInt(1) ||
    intent.account === intent.recipient
  )
    throw new Error("Unsupported transfer intent.");
  validateTransferReview(
    entry,
    intent.account,
    intent.recipient,
    intent.token,
    addressCredentials(entry).signatureExpirationLedger(),
    intent.units,
  );
}

export function validateTransferEnvelope(
  envelope: string,
  hash: string | null,
  sponsor: string,
  intent: TransferIntent,
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
    // Legacy XLM reviews used a 180-second submission window.
    Number(tx.timeBounds.maxTime) >
      Math.floor(expires / 1000) +
        (intent.token === TESTNET_ASSETS.XLM ? 180 : 0) ||
    BigInt(tx.fee) > BigInt(5_000_000)
  )
    throw new Error("Transaction evidence does not match this payment.");
  const op = tx.operations[0];

  const func = transferFunction(
    intent.token,
    intent.account,
    intent.recipient,
    BigInt(intent.units),
  );

  if (
    op.type !== "invokeHostFunction" ||
    (op.source !== undefined && op.source !== sponsor) ||
    !op.func.toXDR().equals(func.toXDR()) ||
    op.auth?.length !== 1
  )
    throw new Error(
      "Transaction invocation does not match the reviewed transfer.",
    );
  validateTransferAuthorization(op.auth[0], intent);
  validateSignedAuthorization(reviewedAuth, op.auth[0].toXDR("base64"));
}
