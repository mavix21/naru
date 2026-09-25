"use client";

import type {
  IndexedDBStorage,
  SmartAccountKit,
  StoredCredential,
} from "smart-account-kit";

import { xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { z } from "zod";

import {
  configSchema,
  jobSchema,
  reviewSchema,
  statusSchema,
  TESTNET,
  type SmartAccountConfig,
  type TransferReview,
} from "./shared";
import { validateTransferReview } from "./transfer";

const endpoint = "/api/dev/smart-account";

const errorSchema = z.object({ error: z.string() });

async function request(path: string, body?: string) {
  const options: RequestInit = {
    cache: "no-store",
    credentials: "same-origin",
  };

  if (body) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    options.body = body;
  }

  const response = await fetch(`${endpoint}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    throw new Error(
      error.success ? error.data.error : "Smart-account endpoint unavailable.",
    );
  }

  return data;
}

/** Browser-only adapter. No private-key material or sponsor credentials enter here. */
export class NaruSmartAccount {
  config: SmartAccountConfig;
  private kit: SmartAccountKit;
  private storage: IndexedDBStorage;
  private connected = false;

  private constructor(
    config: SmartAccountConfig,
    kit: SmartAccountKit,
    storage: IndexedDBStorage,
  ) {
    this.config = config;
    this.kit = kit;
    this.storage = storage;
  }

  static async open() {
    if (
      !window.isSecureContext ||
      !window.PublicKeyCredential ||
      !navigator.credentials
    ) {
      throw new Error(
        "Passkeys are unavailable. Use a WebAuthn-capable browser on localhost or the configured HTTPS origin.",
      );
    }

    const config = configSchema.parse(await request(""));

    if (window.location.origin !== config.origin)
      throw new Error(
        `Open this screen at ${config.origin}; passkeys are bound to its RP ID.`,
      );

    // The kit expects Buffer in the browser. Initialize it before importing the kit.
    if (!globalThis.Buffer)
      Object.defineProperty(globalThis, "Buffer", {
        value: Buffer,
        configurable: true,
        writable: true,
      });

    const { SmartAccountKit, IndexedDBStorage } =
      await import("smart-account-kit");

    const storage = new IndexedDBStorage(`naru-slice1-testnet-${config.rpId}`);

    const kit = new SmartAccountKit({
      ...TESTNET,
      storage,
      rpId: config.rpId,
      rpName: "Naru testnet validation",
      allowedOrigins: [config.origin],
      indexerUrl: false,
      signatureExpirationLedgers: 60,
    });

    return new NaruSmartAccount(config, kit, storage);
  }

  async metadata(): Promise<StoredCredential | null> {
    const credentials = await this.storage.getAll();

    if (credentials.length > 1)
      throw new Error(
        "Multiple local credentials found. Resolve the stored account explicitly; no new account will be created.",
      );

    return credentials[0] || null;
  }

  async status() {
    const metadata = await this.metadata();

    if (!metadata) return null;

    const status = statusSchema.parse(
      await request(`?account=${encodeURIComponent(metadata.contractId)}`),
    );

    const deployment = status.jobs.find(
      (job) => job.kind === "deploy" && job.state === "confirmed",
    );

    if (deployment?.hash && deployment.ledger) {
      // Local birth descriptor was recorded by the kit from the exact constructor.
      // connectWallet independently verifies this receipt against chain history.
      await this.storage.update(metadata.credentialId, {
        creationTransactionHash: deployment.hash,
        creationLedger: deployment.ledger,
        deploymentTransactionHash: deployment.hash,
        deploymentStatus: "deployed",
      });
    }

    return status;
  }

  async create() {
    if (await this.metadata())
      throw new Error(
        "An account credential already exists. Restore or resume it instead.",
      );

    const created = await this.kit.createWallet(
      "Naru testnet",
      "Naru validation account",
      {
        autoSubmit: false,
        authenticatorSelection: { residentKey: "required" },
      },
    );

    if (!created.relayerPayload)
      throw new Error(
        "Kit returned no deployment payload. The existing credential is retained; use Resume.",
      );

    return jobSchema.parse(
      await request(
        "",
        JSON.stringify({
          action: "deploy",
          account: created.contractId,
          credentialId: created.credentialId,
          publicKey: Buffer.from(created.publicKey).toString("hex"),
          payload: created.relayerPayload,
        }),
      ),
    );
  }

  async resumeDeployment() {
    const metadata = await this.metadata();

    if (!metadata) throw new Error("No local credential to resume.");
    const status = await this.status();

    const unresolved = status?.jobs.find(
      (job) => job.kind === "deploy" && job.state !== "failed",
    );

    if (unresolved && unresolved.state !== "review") return unresolved;

    const deployment = await this.kit.credentials.deploy(
      metadata.credentialId,
      { autoSubmit: false },
    );

    if (
      !deployment.relayerPayload ||
      deployment.contractId !== metadata.contractId
    )
      throw new Error("Deployment could not be rebuilt for the same account.");

    return jobSchema.parse(
      await request(
        "",
        JSON.stringify({
          action: "deploy",
          account: metadata.contractId,
          credentialId: metadata.credentialId,
          publicKey: Buffer.from(metadata.publicKey).toString("hex"),
          payload: deployment.relayerPayload,
        }),
      ),
    );
  }

  async restore() {
    this.connected = false;
    const metadata = await this.metadata();

    if (!metadata)
      throw new Error(
        "No same-browser metadata. Cross-device recovery is not enabled in this slice.",
      );
    await this.status();
    // `fresh` deliberately requests a native passkey prompt on every reload/restore.
    const result = await this.kit.connectWallet({ fresh: true });

    if (
      !result ||
      result.contractId !== metadata.contractId ||
      result.credentialId !== metadata.credentialId
    ) {
      await this.kit.disconnect();
      throw new Error(
        "The selected passkey does not match the saved account. No account was created.",
      );
    }

    this.connected = true;

    return result.contractId;
  }

  private async account() {
    const metadata = await this.metadata();

    if (!this.connected || !metadata)
      throw new Error("Restore this account with its passkey first.");

    return metadata.contractId;
  }

  async fund() {
    return jobSchema.parse(
      await request(
        "",
        JSON.stringify({ action: "fund", account: await this.account() }),
      ),
    );
  }

  async review() {
    return reviewSchema.parse(
      await request(
        "",
        JSON.stringify({ action: "review", account: await this.account() }),
      ),
    );
  }

  async authorize(review: TransferReview) {
    const account = await this.account();

    if (
      review.account !== account ||
      review.recipient !== this.config.recipient ||
      review.token !== this.config.token ||
      review.amount !== this.config.transferAmount ||
      review.expiresAt <= Date.now()
    )
      throw new Error("Transfer review expired or changed. Review again.");

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(review.auth, "base64");
    validateTransferReview(
      entry,
      account,
      review.recipient,
      review.token,
      review.expiration,
    );

    const auth = await this.kit.signAuthEntry(entry, {
      expiration: review.expiration,
      contextRuleIds: [0],
    });

    return jobSchema.parse(
      await request(
        "",
        JSON.stringify({
          action: "authorize",
          id: review.id,
          auth: auth.toXDR("base64"),
        }),
      ),
    );
  }
}

export function smartAccountError(error: Error) {
  if (
    error.name === "NotAllowedError" ||
    /cancel|not allowed|timed out|denied/i.test(error.message)
  ) {
    return "Passkey request was cancelled, denied, or timed out. Nothing is confirmed; refresh transaction status before retrying.";
  }

  return error.message;
}
