import "server-only";
import {
  Address,
  authorizeEntry,
  BASE_FEE,
  hash,
  Keypair,
  Operation,
  rpc,
  scValToBigInt,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  parseAmount,
  TESTNET_ASSETS,
  transferShortfall,
  type TransferAsset,
} from "@/lib/money";
import { SWAP } from "@/lib/swaps/shared";

import type { Deployment } from "../payments";

import {
  TESTNET,
  TEST_FUNDING,
  jobSchema,
  type AccountStatus,
  type Job,
  type TransferReview,
} from "../shared";
import { transferFunction } from "../transfer";
import { serverConfig } from "./config";
import { buildFundingTransfer } from "./funding";
import {
  addressCredentials,
  validateDeployment,
  validateSignedAuthorization,
} from "./policy";
import { readContract, stellarRpc } from "./rpc";
import { SponsorStore, type RecordEntry } from "./store";
import {
  validateTransferAuthorization,
  validateTransferEnvelope,
  type TransferIntent,
} from "./transfer-policy";

export { stellarRpc } from "./rpc";

const server = stellarRpc;

const MAX_FEE_STROOPS = BigInt(5_000_000); // 0.5 test XLM, including resource fees

export class SmartAccountService {
  config = serverConfig();
  store = new SponsorStore();

  async ready() {
    const [network, code, verifier] = await Promise.all([
      server.getNetwork(),
      server.getLedgerEntries(
        xdr.LedgerKey.contractCode(
          new xdr.LedgerKeyContractCode({
            hash: Buffer.from(TESTNET.accountWasmHash, "hex"),
          }),
        ),
      ),
      server.getContractData(
        TESTNET.webauthnVerifierAddress,
        xdr.ScVal.scvLedgerKeyContractInstance(),
      ),
      server.getAccount(this.config.sponsor.publicKey()),
      server.getAccount(this.config.publicConfig.recipient),
    ]);

    if (
      network.passphrase !== TESTNET.networkPassphrase ||
      !code.entries.length ||
      verifier.val
        .contractData()
        .val()
        .instance()
        .executable()
        .wasmHash()
        .toString("hex") !== TESTNET.verifierWasmHash
    ) {
      throw new Error(
        "Pinned testnet smart-account infrastructure is unavailable. Check for a testnet reset.",
      );
    }

    if (
      BigInt(await this.balance(this.config.sponsor.publicKey())) <
      BigInt(55_000_000)
    ) {
      throw new Error(
        "Naru’s testnet fee account needs refilling. Please try again shortly.",
      );
    }

    return this.config.publicConfig;
  }

  async transaction(
    func: xdr.HostFunction,
    auth: xdr.SorobanAuthorizationEntry[],
    deadline?: number,
  ) {
    return new TransactionBuilder(
      await server.getAccount(this.config.sponsor.publicKey()),
      {
        fee: BASE_FEE,
        networkPassphrase: TESTNET.networkPassphrase,
      },
    )
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimebounds(0, deadline ?? Math.floor(Date.now() / 1000) + 180)
      .build();
  }

  async balance(account: string, token = this.config.publicConfig.token) {
    const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(token).toScAddress(),
        functionName: "balance",
        args: [Address.fromString(account).toScVal()],
      }),
    );

    const simulation = await server.simulateTransaction(
      await this.transaction(func, []),
    );

    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result)
      throw new Error("Could not read testnet asset balance.");

    return scValToBigInt(simulation.result.retval).toString();
  }

  async readContract(contract: string, method: string, args: xdr.ScVal[] = []) {
    return readContract(
      this.config.publicConfig.sponsor,
      contract,
      method,
      args,
    );
  }

  async usdcBalance(account: string) {
    const entry = await server.getContractData(
      SWAP.usdc,
      xdr.ScVal.scvLedgerKeyContractInstance(),
    );

    if (
      entry.val.contractData().val().instance().executable().switch().name !==
        "contractExecutableStellarAsset" ||
      (await this.readContract(SWAP.usdc, "name")) !== `USDC:${SWAP.issuer}` ||
      (await this.readContract(SWAP.usdc, "decimals")) !== 7
    )
      throw new Error(
        "The official Testnet USDC identity could not be verified.",
      );

    return this.balance(account, SWAP.usdc);
  }

  async requireTransferBalance(
    account: string,
    asset: TransferAsset,
    units: string,
  ) {
    let balance: string;

    try {
      balance =
        asset === "USDC"
          ? await this.usdcBalance(account)
          : await this.balance(account);
    } catch {
      throw new Error(
        `${asset} balance is unavailable. Refresh and try again; nothing was sent.`,
      );
    }

    const shortfall = transferShortfall(units, balance);

    if (shortfall !== "0")
      throw new Error(
        `You need ${shortfall} more ${asset}. ${asset === "USDC" ? "Review an XLM → USDC swap first, then authorize this transfer separately." : "Add test XLM or choose a smaller amount."}`,
      );
  }

  async walletBalances(account: string) {
    const [xlm, usdc] = await Promise.allSettled([
      this.balance(account),
      this.usdcBalance(account),
    ]);

    return {
      account,
      balance: xlm.status === "fulfilled" ? xlm.value : null,
      balanceError:
        xlm.status === "fulfilled"
          ? null
          : "XLM balance is unavailable. Please refresh.",
      usdcBalance: usdc.status === "fulfilled" ? usdc.value : null,
      usdcBalanceError:
        usdc.status === "fulfilled"
          ? null
          : "USDC balance is unavailable. Please refresh.",
    };
  }

  async requireAccount(account: string) {
    const deployment = (await this.store.accountJobs(account)).find(
      (job) => job.kind === "deploy" && job.state === "confirmed",
    );

    if (!deployment)
      throw new Error("This account has no confirmed Naru testnet deployment.");

    const entry = await server.getContractData(
      account,
      xdr.ScVal.scvLedgerKeyContractInstance(),
    );

    if (
      entry.val
        .contractData()
        .val()
        .instance()
        .executable()
        .wasmHash()
        .toString("hex") !== TESTNET.accountWasmHash
    ) {
      throw new Error("Account code no longer matches this test flow.");
    }
  }

  async status(account: string): Promise<AccountStatus> {
    const records = await this.store.accountJobs(account);
    const jobs: Job[] = [];

    for (const record of records) jobs.push(await this.reconcile(record));

    const deployed = jobs.some(
      (job) => job.kind === "deploy" && job.state === "confirmed",
    );

    if (deployed) await this.requireAccount(account);

    let balance: string | null = null;
    let balanceError: string | null = null;
    let usdcBalance: string | null = null;
    let usdcBalanceError: string | null = null;

    if (deployed) {
      const [xlm, usdc] = await Promise.allSettled([
        this.balance(account),
        this.usdcBalance(account),
      ]);

      if (xlm.status === "fulfilled") balance = xlm.value;
      else balanceError = "XLM balance is unavailable. Please refresh.";

      if (usdc.status === "fulfilled") usdcBalance = usdc.value;
      else usdcBalanceError = "USDC balance is unavailable. Please refresh.";
    }

    return {
      account,
      deployed,
      balance,
      balanceError,
      usdcBalance,
      usdcBalanceError,
      jobs,
    };
  }

  async deploy(
    account: string,
    credentialId: string,
    publicKey: string,
    payload: { func: string; auth: string[] },
  ) {
    const func = xdr.HostFunction.fromXDR(payload.func, "base64");

    const auth = payload.auth.map((value) =>
      xdr.SorobanAuthorizationEntry.fromXDR(value, "base64"),
    );

    validateDeployment(
      func,
      auth,
      account,
      credentialId,
      Buffer.from(publicKey, "hex"),
      TESTNET,
    );

    const previous = (await this.store.accountJobs(account)).find(
      (job) => job.kind === "deploy" && job.state !== "failed",
    );

    if (previous) {
      if (previous.state !== "review") {
        const current = await this.reconcile(previous);

        if (current.state !== "failed") return current;
      }

      if (previous.func !== payload.func)
        throw new Error("Existing deployment has different constructor data.");
    }

    await this.ready();
    await this.store.rate(
      `deploy:${new Date().toISOString().slice(0, 10)}`,
      10,
    );

    const job = await this.store.insert(
      randomUUID(),
      account,
      "deploy",
      payload.func,
      JSON.stringify(payload.auth),
      Date.now() + 180_000,
    );

    return this.submit(job, auth);
  }

  async resumeVerifiedDeployment(deployment: Deployment) {
    const previous = (await this.store.accountJobs(deployment.account)).find(
      (job) => job.kind === "deploy" && job.state !== "failed",
    );

    // Never replace an ambiguous signed envelope or allocate a second account.
    if (previous && previous.state !== "review") {
      const current = await this.reconcile(previous);

      if (current.state !== "failed") return current;
    }

    const func = xdr.HostFunction.fromXDR(deployment.payload.func, "base64");

    const originalAuth = deployment.payload.auth.map((entry) =>
      xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64"),
    );

    validateDeployment(
      func,
      originalAuth,
      deployment.account,
      deployment.credentialId,
      Buffer.from(deployment.publicKey, "hex"),
      TESTNET,
    );

    // Only the kit's PUBLIC deployment signer is renewed here, never a user's
    // passkey authorization. Ownership and the immutable constructor were
    // already verified before this payload was persisted for the user.
    const simulation = await server.simulateTransaction(
      await this.transaction(func, []),
      undefined,
      "record",
      true,
    );

    if (
      !rpc.Api.isSimulationSuccess(simulation) ||
      simulation.result?.auth?.length !== 1
    ) {
      throw new Error(
        "Could not prepare the saved account for activation. Please retry.",
      );
    }

    const deployer = Keypair.fromRawEd25519Seed(
      hash(Buffer.from("openzeppelin-smart-account-kit")),
    );

    // RPC may record V2 credentials; keep the kit's validated V1 entry and
    // exact invocation, renewing only the public deployer's nonce and expiry.
    const entry = originalAuth[0];
    const recorded = simulation.result.auth[0];

    if (
      !entry.rootInvocation().toXDR().equals(recorded.rootInvocation().toXDR())
    ) {
      throw new Error(
        "The network returned a different deployment invocation.",
      );
    }

    addressCredentials(entry).nonce(addressCredentials(recorded).nonce());
    addressCredentials(entry).signature(xdr.ScVal.scvVoid());

    const signed = await authorizeEntry(
      entry,
      deployer,
      simulation.latestLedger + 60,
      TESTNET.networkPassphrase,
    );

    return this.deploy(
      deployment.account,
      deployment.credentialId,
      deployment.publicKey,
      {
        func: deployment.payload.func,
        auth: [signed.toXDR("base64")],
      },
    );
  }

  async fund(account: string, requestId: string = randomUUID()) {
    await this.requireAccount(account);

    // Retries of a chat turn or button request never create a second top-up.
    const id = `fund:${account}:${requestId}`;
    const existing = await this.store.get(id);

    if (existing) {
      if (existing.state !== "review") return this.reconcile(existing);

      if (existing.expires <= Date.now()) {
        await this.store.finish(
          existing.id,
          "failed",
          null,
          "This top-up expired before it was sent. Please try again.",
          "review",
        );

        return this.reconcile((await this.store.get(existing.id))!);
      }

      return this.submit(
        existing,
        z
          .array(z.string())
          .parse(JSON.parse(existing.auth))
          .map((entry) =>
            xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64"),
          ),
      );
    }

    const previous = (await this.store.accountJobs(account)).find(
      (job) =>
        job.kind === "fund" &&
        job.state !== "failed" &&
        job.state !== "confirmed",
    );

    if (previous && previous.state !== "review") {
      const current = await this.reconcile(previous);

      if (current.state !== "failed") return current;
    }

    const { func, auth } = buildFundingTransfer(
      this.config.publicConfig.token,
      this.config.sponsor.publicKey(),
      account,
    );

    const job = await this.store.insert(
      id,
      account,
      "fund",
      func.toXDR("base64"),
      JSON.stringify(auth.map((entry) => entry.toXDR("base64"))),
      Date.now() + 180_000,
    );

    return this.submit(
      job,
      z
        .array(z.string())
        .parse(JSON.parse(job.auth))
        .map((entry) => xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64")),
    );
  }

  async review(
    account: string,
    transfer: { recipient: string; amount: string; asset?: TransferAsset } = {
      recipient: this.config.publicConfig.recipient,
      amount: "0.1",
    },
  ): Promise<TransferReview> {
    await this.store.rate(
      `review:${new Date().toISOString().slice(0, 10)}`,
      100,
    );
    await this.requireAccount(account);
    const asset = transfer.asset ?? "XLM";
    const token = TESTNET_ASSETS[asset];
    const { units, amount } = parseAmount(transfer.amount, asset);
    await this.requireTransferBalance(account, asset, units);

    const func = transferFunction(
      token,
      account,
      transfer.recipient,
      BigInt(units),
    );

    const simulation = await server.simulateTransaction(
      await this.transaction(func, []),
      undefined,
      "record",
      true,
    );

    if (
      !rpc.Api.isSimulationSuccess(simulation) ||
      simulation.result?.auth?.length !== 1
    )
      throw new Error(
        "Transfer simulation failed or returned unexpected authorization requirements.",
      );
    const entry = simulation.result.auth[0];

    validateTransferAuthorization(entry, {
      account,
      recipient: transfer.recipient,
      token,
      units,
    });

    const expiration = simulation.latestLedger + 60;
    addressCredentials(entry).signatureExpirationLedger(expiration);
    addressCredentials(entry).signature(xdr.ScVal.scvVoid());
    const expiresAt = Date.now() + 120_000;
    const id = randomUUID();
    const auth = entry.toXDR("base64");
    await this.store.insert(
      id,
      account,
      "transfer",
      func.toXDR("base64"),
      auth,
      expiresAt,
    );

    return {
      id,
      account,
      recipient: transfer.recipient,
      token,
      asset,
      amount,
      auth,
      expiration,
      expiresAt,
    };
  }

  async authorize(id: string, authXdr: string, expected?: TransferIntent) {
    const job = await this.store.get(id);

    if (!job || job.kind !== "transfer")
      throw new Error("Unknown transfer review.");

    if (job.state !== "review") return this.reconcile(job);
    const auth = validateSignedAuthorization(job.auth, authXdr);

    if (expected) {
      this.assertTransfer(job, expected);
      validateTransferAuthorization(auth, expected);
    }

    return this.submit(
      job,
      [auth],
      expected
        ? (tx) => {
            validateTransferEnvelope(
              tx.toXDR(),
              tx.hash().toString("hex"),
              this.config.publicConfig.sponsor,
              expected,
              job.auth,
              job.expires,
            );
          }
        : undefined,
    );
  }

  assertTransfer(
    job: RecordEntry,
    expected: {
      account: string;
      recipient: string;
      token: string;
      units: string;
    },
  ) {
    const func = transferFunction(
      expected.token,
      expected.account,
      expected.recipient,
      BigInt(expected.units),
    );

    if (
      job.kind !== "transfer" ||
      job.account !== expected.account ||
      job.func !== func.toXDR("base64")
    )
      throw new Error(
        "Transaction intent does not match the exact saved payment.",
      );

    validateTransferAuthorization(
      xdr.SorobanAuthorizationEntry.fromXDR(job.auth, "base64"),
      expected,
    );

    if (job.envelope) {
      validateTransferEnvelope(
        job.envelope,
        job.hash,
        this.config.publicConfig.sponsor,
        expected,
        job.auth,
        job.expires,
      );
    } else if (job.state === "confirmed")
      throw new Error("Confirmed envelope missing.");
  }

  async submit(
    job: RecordEntry,
    auth: xdr.SorobanAuthorizationEntry[],
    validatePrepared?: (transaction: Transaction) => void,
  ): Promise<Job> {
    // A previous funding, deployment, or transfer may belong to another user.
    // Reconcile its saved envelope before claiming the sponsor for a new send.
    // An ambiguous submission stays locked; abandoned preparation can expire.
    const inFlight = await this.store.inFlight();

    if (inFlight) await this.reconcile(inFlight);

    if (!(await this.store.claim(job.id)))
      return this.reconcile((await this.store.get(job.id))!);
    let persisted = false;

    try {
      await this.store.rate(
        `submit:${new Date().toISOString().slice(0, 10)}`,
        60,
      );

      // The sponsor sequence is reserved before replenishing. Friendbot funds
      // this G-address; the existing SAC transfer delivers XLM to the wallet.
      if (job.kind === "fund") await this.ensureTestFunding();

      const transaction = await this.transaction(
        xdr.HostFunction.fromXDR(job.func, "base64"),
        auth,
        job.kind === "swap" || job.kind === "transfer"
          ? Math.floor(job.expires / 1000)
          : undefined,
      );

      // Enforce passkey/deployer signatures BEFORE spending sponsor fees. Then
      // re-simulate the signed invocation to budget actual verifier resources.
      const simulation = await server.simulateTransaction(
        transaction,
        undefined,
        "enforce",
      );

      if (!rpc.Api.isSimulationSuccess(simulation)) {
        if (job.kind === "swap" && rpc.Api.isSimulationError(simulation))
          console.error(
            "Soroswap authorization simulation rejected:",
            simulation.error.split("\n")[0],
            simulation.error.match(/Error\(Contract, #\d+\)/)?.[0] ?? "",
          );
        throw new Error(
          job.kind === "swap"
            ? "The swap authorization or minimum receive check failed. No exchange was submitted. Request a fresh quote."
            : rpc.Api.isSimulationError(simulation)
              ? `Testnet simulation rejected: ${simulation.error}`
              : "Contract state requires restoration; no transaction sent.",
        );
      }

      const prepared = rpc.assembleTransaction(transaction, simulation).build();

      if (job.kind === "swap" && job.expires <= Date.now())
        throw new Error(
          "Quote expired during authorization. No transaction was sent.",
        );

      if (BigInt(prepared.fee) > MAX_FEE_STROOPS)
        throw new Error(
          "Estimated fee exceeds the 0.5 test XLM sponsorship cap.",
        );
      validatePrepared?.(prepared);
      prepared.sign(this.config.sponsor);
      // Commit the exact signed envelope/hash BEFORE any network send. Replays
      // reuse this envelope and sequence across Vercel invocations.
      await this.store.pending(
        job.id,
        prepared.hash().toString("hex"),
        prepared.toXDR(),
      );
      persisted = true;
      await server.sendTransaction(prepared);
    } catch (error) {
      if (!persisted)
        await this.store.finish(
          job.id,
          "failed",
          null,
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Submission preparation failed.",
          "preparing",
        );
      // A transport error after persistence is ambiguous, never a confirmed failure.
    }

    return this.reconcile((await this.store.get(job.id))!);
  }

  private async ensureTestFunding() {
    const sponsor = this.config.sponsor.publicKey();
    const minimum = BigInt(TEST_FUNDING.units) + BigInt(20_000_000);

    if (BigInt(await this.balance(sponsor)) >= minimum) return;

    try {
      const response = await fetch(
        `https://friendbot.stellar.org/?addr=${encodeURIComponent(sponsor)}`,
        {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) throw new Error("Friendbot unavailable");

      // Verify spendable funding on our pinned network, not just an HTTP 200.
      if (BigInt(await this.balance(sponsor)) < minimum)
        throw new Error("Refill not visible yet");
    } catch {
      throw new Error(
        "Free test XLM is temporarily unavailable while Naru refills with Friendbot. Please try again in a minute.",
      );
    }
  }

  async reconcile(job: RecordEntry): Promise<Job> {
    if (job.state === "preparing") job = await this.store.recover(job.id);

    if (job.state !== "pending" || !job.hash || !job.envelope)
      return jobSchema.parse(job);

    try {
      return await this.confirm(job);
    } catch {
      return {
        ...jobSchema.parse(job),
        error:
          "Confirmation service unavailable. Submission remains pending; retain this transaction hash.",
      };
    }
  }

  private async confirm(job: RecordEntry): Promise<Job> {
    if (!job.hash || !job.envelope)
      throw new Error("Missing persisted submission.");
    const result = await server.getTransaction(job.hash);

    if (result.status === "SUCCESS") {
      const confirmed = TransactionBuilder.fromXDR(
        result.envelopeXdr,
        TESTNET.networkPassphrase,
      );

      if (
        confirmed.hash().toString("hex") !== job.hash ||
        confirmed.toXDR() !== job.envelope
      )
        throw new Error(
          "RPC confirmation did not match the persisted signed transaction.",
        );
      await this.store.finish(
        job.id,
        "confirmed",
        result.ledger,
        null,
        "pending",
        job.kind === "swap" ? result.returnValue?.toXDR("base64") : undefined,
      );
    } else if (result.status === "FAILED") {
      await this.store.finish(
        job.id,
        "failed",
        result.ledger,
        job.kind === "swap"
          ? "The swap failed on Stellar Testnet. No exchange was completed."
          : `On-chain failure: ${result.resultXdr.toXDR("base64")}`,
        "pending",
      );
    } else {
      const transaction = TransactionBuilder.fromXDR(
        job.envelope,
        TESTNET.networkPassphrase,
      );

      if (
        transaction instanceof Transaction &&
        Number(transaction.timeBounds?.maxTime) * 1000 > Date.now()
      ) {
        // Safe after an ambiguous timeout: same hash, same sequence, same auth.
        await server.sendTransaction(transaction);
      } else {
        return {
          ...jobSchema.parse(job),
          error:
            "Confirmation unknown after transaction expiry. Do not repeat payment. Operator must reconcile this hash using testnet history; sponsor remains locked.",
        };
      }
      // NOT_FOUND is not proof of failure (RPC history is finite). Remain pending.
    }

    return jobSchema.parse(await this.store.get(job.id));
  }
}
