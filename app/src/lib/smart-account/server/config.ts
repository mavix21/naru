import "server-only";
import { Asset, hash, Keypair, StrKey } from "@stellar/stellar-sdk";
import { isAbsolute } from "node:path";

import { TESTNET, type SmartAccountConfig } from "../shared";

export function serverConfig() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      "This slice requires a single Node deployment with persistent SQLite storage, not ephemeral serverless functions.",
    );
  }

  const origin = new URL(
    process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000",
  );

  const rpId = process.env.NARU_SMART_ACCOUNT_RP_ID || "localhost";

  if (
    origin.origin !== origin.href.replace(/\/$/, "") ||
    origin.hostname !== rpId ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && rpId === "localhost"))
  ) {
    throw new Error(
      "Set an exact WebAuthn origin and matching RP ID (localhost or a stable HTTPS hostname).",
    );
  }

  const secret = process.env.NARU_SMART_ACCOUNT_SPONSOR_SECRET;

  if (!secret)
    throw new Error(
      "Set NARU_SMART_ACCOUNT_SPONSOR_SECRET to a dedicated Friendbot-funded testnet account.",
    );
  const sponsor = Keypair.fromSecret(secret);

  const publicDeployer = Keypair.fromRawEd25519Seed(
    hash(Buffer.from("openzeppelin-smart-account-kit")),
  ).publicKey();

  if (sponsor.publicKey() === publicDeployer)
    throw new Error(
      "The kit's public deployer cannot be a sponsor. Use a dedicated testnet key.",
    );
  const recipient = process.env.NARU_SMART_ACCOUNT_RECIPIENT || "";

  if (!StrKey.isValidEd25519PublicKey(recipient)) {
    throw new Error(
      "Set NARU_SMART_ACCOUNT_RECIPIENT to a funded testnet G-address.",
    );
  }

  if (recipient === sponsor.publicKey())
    throw new Error("Use a separate testnet recipient.");

  const database =
    process.env.NARU_SMART_ACCOUNT_DB ||
    (process.env.NODE_ENV === "development"
      ? ".naru-smart-account.sqlite"
      : "");

  if (
    !database ||
    (process.env.NODE_ENV !== "development" && !isAbsolute(database))
  ) {
    throw new Error(
      "Set NARU_SMART_ACCOUNT_DB to an absolute path on persistent local storage (single Node deployment).",
    );
  }

  const publicConfig: SmartAccountConfig = {
    origin: origin.origin,
    rpId,
    recipient,
    sponsor: sponsor.publicKey(),
    token: Asset.native().contractId(TESTNET.networkPassphrase),
    transferAmount: "0.1",
    fundingAmount: "5",
  };

  return { sponsor, database, publicConfig };
}
