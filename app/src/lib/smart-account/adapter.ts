"use client";

import type {
  IndexedDBStorage,
  SmartAccountKit,
  StoredCredential,
} from "smart-account-kit";

import { xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { z } from "zod";

import { parseAmount } from "@/lib/money";

import {
  challengeSchema,
  paymentStateSchema,
  reservationSchema,
} from "./payments";
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

const errorSchema = z.object({ error: z.string() });

// The browser Buffer polyfill supports base64, but not Node's base64url codec.
function decodePasskey(value: string) {
  return Uint8Array.from(
    Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
}

function encodePasskey(value: ArrayBuffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function cancelledCreation(error: Error): boolean {
  return (
    error.name === "NotAllowedError" ||
    (error.cause instanceof Error && cancelledCreation(error.cause))
  );
}

async function request(
  endpoint: string,
  path: string,
  body?: string,
  userId?: string,
) {
  const headers = new Headers();

  if (userId) headers.set("X-Naru-User", userId);

  const options: RequestInit = {
    cache: "no-store",
    credentials: "same-origin",
    headers,
  };

  if (body) {
    options.method = "POST";
    headers.set("Content-Type", "application/json");
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
  private endpoint: string;
  private connected = false;
  private userId?: string;

  private constructor(
    config: SmartAccountConfig,
    kit: SmartAccountKit,
    storage: IndexedDBStorage,
    endpoint: string,
    userId?: string,
  ) {
    this.config = config;
    this.kit = kit;
    this.storage = storage;
    this.endpoint = endpoint;
    this.userId = userId;
  }

  static async open(endpoint: string, userId?: string) {
    if (
      !window.isSecureContext ||
      !window.PublicKeyCredential ||
      !navigator.credentials
    ) {
      throw new Error(
        "Passkeys are unavailable. Use a WebAuthn-capable browser on localhost or the configured HTTPS origin.",
      );
    }

    const config = configSchema.parse(
      await request(endpoint, userId ? "?view=config" : "", undefined, userId),
    );

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

    // Product credentials never read the legacy development account database.
    const storage = new IndexedDBStorage(
      userId
        ? `naru-payments-testnet-${config.rpId}-${userId}`
        : `naru-slice1-testnet-${config.rpId}`,
    );

    const kit = new SmartAccountKit({
      ...TESTNET,
      storage,
      rpId: config.rpId,
      rpName: "Naru",
      allowedOrigins: [config.origin],
      indexerUrl: false,
      signatureExpirationLedgers: 60,
    });

    return new NaruSmartAccount(config, kit, storage, endpoint, userId);
  }

  private request(path: string, body?: string) {
    return request(this.endpoint, path, body, this.userId);
  }

  async metadata(): Promise<StoredCredential | null> {
    const credentials = await this.storage.getAll();

    if (credentials.length > 1)
      throw new Error(
        "Multiple local credentials found. Resolve the stored account explicitly; no new account will be created.",
      );

    return credentials[0] || null;
  }

  async activate(device: string, onConfirm: () => void) {
    const reservation = reservationSchema.parse(
      await this.request("", JSON.stringify({ action: "begin", device })),
    );

    if (reservation.linked) {
      return paymentStateSchema.parse(
        await this.request("", JSON.stringify({ action: "resume" })),
      );
    }

    let metadata = await this.metadata();

    if (!metadata) {
      if (reservation.started) {
        throw new Error(
          "Passkey creation was interrupted. Continue in the original browser with its saved passkey; a second account will not be created.",
        );
      }

      await this.request(
        "",
        JSON.stringify({
          action: "start",
          attempt: reservation.attempt,
          device,
        }),
      );

      try {
        await this.kit.createWallet("Naru", "Naru payments", {
          autoSubmit: false,
          authenticatorSelection: { residentKey: "required" },
        });
      } catch (error) {
        // Only a definitively cancelled ceremony can release creation. Network
        // failures after credential storage must resume that same credential.
        if (
          error instanceof Error &&
          cancelledCreation(error) &&
          !(await this.metadata())
        ) {
          await this.request(
            "",
            JSON.stringify({
              action: "cancel",
              attempt: reservation.attempt,
              device,
            }),
          );
        }

        throw error;
      }

      metadata = await this.metadata();
    }

    if (!metadata)
      throw new Error("Your passkey could not be saved in this browser.");

    const prepared = await this.kit.credentials.deploy(metadata.credentialId, {
      autoSubmit: false,
    });

    if (
      !prepared.relayerPayload ||
      prepared.contractId !== metadata.contractId
    ) {
      throw new Error("Could not prepare the saved account. Please retry.");
    }

    const deployment = {
      account: metadata.contractId,
      credentialId: metadata.credentialId,
      publicKey: Buffer.from(metadata.publicKey).toString("hex"),
      payload: prepared.relayerPayload,
    };

    const { challenge } = challengeSchema.parse(
      await this.request(
        "",
        JSON.stringify({
          action: "challenge",
          attempt: reservation.attempt,
          device,
          deployment,
        }),
      ),
    );

    onConfirm();

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: decodePasskey(challenge),
        rpId: this.config.rpId,
        userVerification: "required",
        timeout: 120_000,
        allowCredentials: [
          {
            type: "public-key",
            id: decodePasskey(metadata.credentialId),
          },
        ],
      },
    });

    if (
      !(credential instanceof PublicKeyCredential) ||
      !(credential.response instanceof AuthenticatorAssertionResponse)
    ) {
      throw new Error("Passkey confirmation was cancelled. Please retry.");
    }

    const response = credential.response;

    return paymentStateSchema.parse(
      await this.request(
        "",
        JSON.stringify({
          action: "verify",
          attempt: reservation.attempt,
          proof: {
            credentialId: encodePasskey(credential.rawId),
            clientDataJSON: encodePasskey(response.clientDataJSON),
            authenticatorData: encodePasskey(response.authenticatorData),
            signature: encodePasskey(response.signature),
          },
        }),
      ),
    );
  }

  async status() {
    const metadata = await this.metadata();

    if (!metadata) return null;

    const payment = this.userId
      ? paymentStateSchema.parse(await this.request(""))
      : null;

    if (payment && payment.account !== metadata.contractId) {
      throw new Error("The saved passkey does not match your payment account.");
    }

    const status = payment
      ? {
          account: metadata.contractId,
          deployed: payment.state === "ready",
          balance: payment.balance,
          balanceError: payment.balanceError,
          jobs: payment.job ? [payment.job] : [],
        }
      : statusSchema.parse(
          await this.request(
            `?account=${encodeURIComponent(metadata.contractId)}`,
          ),
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
        this.endpoint,
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
        this.endpoint,
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
        this.endpoint,
        "",
        JSON.stringify({ action: "fund", account: await this.account() }),
      ),
    );
  }

  async review() {
    return reviewSchema.parse(
      await request(
        this.endpoint,
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
        this.endpoint,
        "",
        JSON.stringify({
          action: "authorize",
          id: review.id,
          auth: auth.toXDR("base64"),
        }),
      ),
    );
  }

  // Product authorization signs only the immutable, server-stored operation
  // currently shown by the card. Submission remains a separate trusted request.
  async signTransfer(
    review: TransferReview,
    expected: {
      account: string;
      recipient: string;
      token: string;
      amount: string;
      units: string;
    },
  ) {
    const account = await this.account();

    if (
      account !== expected.account ||
      review.account !== account ||
      review.recipient !== expected.recipient ||
      review.token !== expected.token ||
      review.token !== this.config.token ||
      review.amount !== expected.amount ||
      parseAmount(review.amount).units !== expected.units ||
      review.expiresAt <= Date.now()
    )
      throw new Error(
        "Transfer review expired or changed. Read the card again.",
      );
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(review.auth, "base64");
    validateTransferReview(
      entry,
      account,
      expected.recipient,
      expected.token,
      review.expiration,
      expected.units,
    );

    const signed = await this.kit.signAuthEntry(entry, {
      expiration: review.expiration,
      contextRuleIds: [0],
    });

    return signed.toXDR("base64");
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
