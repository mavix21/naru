import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  rpc,
  scValToBigInt,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { randomUUID } from "node:crypto";

import {
  TESTNET,
  jobSchema,
  type AccountStatus,
  type Job,
  type TransferReview,
} from "../shared";
import { serverConfig } from "./config";
import { buildFundingTransfer } from "./funding";
import {
  addressCredentials,
  validateDeployment,
  validateSignedAuthorization,
} from "./policy";
import { SponsorStore, type RecordEntry } from "./store";

const server = new rpc.Server(TESTNET.rpcUrl, { timeout: 20_000 });

const MAX_FEE_STROOPS = BigInt(5_000_000); // 0.5 test XLM, including resource fees

function transferFunction(
  token: string,
  from: string,
  to: string,
  amount: bigint,
) {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(token).toScAddress(),
      functionName: "transfer",
      args: [
        Address.fromString(from).toScVal(),
        Address.fromString(to).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
      ],
    }),
  );
}

export class SmartAccountService {
  config = serverConfig();
  store = new SponsorStore(this.config.database);

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
        "Sponsor needs at least 5.5 test XLM for the funding grant and capped fees. Fund its G-address with Friendbot.",
      );
    }

    return this.config.publicConfig;
  }

  async transaction(
    func: xdr.HostFunction,
    auth: xdr.SorobanAuthorizationEntry[],
  ) {
    return new TransactionBuilder(
      await server.getAccount(this.config.sponsor.publicKey()),
      {
        fee: BASE_FEE,
        networkPassphrase: TESTNET.networkPassphrase,
      },
    )
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimeout(180)
      .build();
  }

  async balance(account: string) {
    const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          this.config.publicConfig.token,
        ).toScAddress(),
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

  async requireAccount(account: string) {
    const deployment = this.store
      .accountJobs(account)
      .find((job) => job.kind === "deploy" && job.state === "confirmed");

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
    const records = this.store.accountJobs(account);
    const jobs: Job[] = [];

    for (const record of records) jobs.push(await this.reconcile(record));

    const deployed = jobs.some(
      (job) => job.kind === "deploy" && job.state === "confirmed",
    );

    if (deployed) await this.requireAccount(account);

    return {
      account,
      deployed,
      balance: deployed ? await this.balance(account) : null,
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

    const previous = this.store
      .accountJobs(account)
      .find((job) => job.kind === "deploy" && job.state !== "failed");

    if (previous) {
      if (previous.state !== "review") return this.reconcile(previous);

      if (previous.func !== payload.func)
        throw new Error("Existing deployment has different constructor data.");
      // No envelope was ever signed for a review-only job. Retire it and
      // rebuild authorization for the same credential after interruption.
      this.store.finish(
        previous.id,
        "failed",
        null,
        "Unsubmitted deployment replaced by an explicit resume.",
      );
    }

    await this.ready();
    this.store.rate(`deploy:${new Date().toISOString().slice(0, 10)}`, 10);

    const job = this.store.insert(
      randomUUID(),
      account,
      "deploy",
      payload.func,
      JSON.stringify(payload.auth),
      Date.now() + 180_000,
    );

    return this.submit(job, auth);
  }

  async fund(account: string) {
    await this.requireAccount(account);

    const previous = this.store
      .accountJobs(account)
      .find((job) => job.kind === "fund" && job.state !== "failed");

    if (previous) {
      if (previous.state !== "review") return this.reconcile(previous);
      this.store.finish(
        previous.id,
        "failed",
        null,
        "Unsubmitted funding intent replaced by an explicit retry.",
      );
    }

    const { func, auth } = buildFundingTransfer(
      this.config.publicConfig.token,
      this.config.sponsor.publicKey(),
      account,
    );

    const job = this.store.insert(
      randomUUID(),
      account,
      "fund",
      func.toXDR("base64"),
      JSON.stringify(auth.map((entry) => entry.toXDR("base64"))),
      Date.now() + 180_000,
    );

    return this.submit(job, auth);
  }

  async review(account: string): Promise<TransferReview> {
    this.store.rate(`review:${new Date().toISOString().slice(0, 10)}`, 100);
    await this.requireAccount(account);

    if (BigInt(await this.balance(account)) < BigInt(1_000_000))
      throw new Error("Insufficient test XLM. Fund the account first.");

    const func = transferFunction(
      this.config.publicConfig.token,
      account,
      this.config.publicConfig.recipient,
      BigInt(1_000_000),
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

    if (
      Address.fromScAddress(addressCredentials(entry).address()).toString() !==
        account ||
      entry.rootInvocation().subInvocations().length !== 0 ||
      !entry
        .rootInvocation()
        .function()
        .contractFn()
        .toXDR()
        .equals(func.invokeContract().toXDR())
    ) {
      throw new Error("Simulation did not match the fixed transfer.");
    }

    const expiration = simulation.latestLedger + 60;
    addressCredentials(entry).signatureExpirationLedger(expiration);
    addressCredentials(entry).signature(xdr.ScVal.scvVoid());
    const expiresAt = Date.now() + 120_000;
    const id = randomUUID();
    const auth = entry.toXDR("base64");
    this.store.insert(
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
      recipient: this.config.publicConfig.recipient,
      token: this.config.publicConfig.token,
      amount: "0.1",
      auth,
      expiration,
      expiresAt,
    };
  }

  async authorize(id: string, authXdr: string) {
    const job = this.store.get(id);

    if (!job || job.kind !== "transfer")
      throw new Error("Unknown transfer review.");

    if (job.state !== "review") return this.reconcile(job);
    const auth = validateSignedAuthorization(job.auth, authXdr);

    return this.submit(job, [auth]);
  }

  async submit(
    job: RecordEntry,
    auth: xdr.SorobanAuthorizationEntry[],
  ): Promise<Job> {
    if (!this.store.claim(job.id))
      return this.reconcile(this.store.get(job.id)!);
    let persisted = false;

    try {
      this.store.rate(`submit:${new Date().toISOString().slice(0, 10)}`, 60);

      const transaction = await this.transaction(
        xdr.HostFunction.fromXDR(job.func, "base64"),
        auth,
      );

      // Enforce passkey/deployer signatures BEFORE spending sponsor fees. Then
      // re-simulate the signed invocation to budget actual verifier resources.
      const simulation = await server.simulateTransaction(
        transaction,
        undefined,
        "enforce",
      );

      if (!rpc.Api.isSimulationSuccess(simulation)) {
        throw new Error(
          rpc.Api.isSimulationError(simulation)
            ? `Testnet simulation rejected: ${simulation.error}`
            : "Contract state requires restoration; no transaction sent.",
        );
      }

      const prepared = rpc.assembleTransaction(transaction, simulation).build();

      if (BigInt(prepared.fee) > MAX_FEE_STROOPS)
        throw new Error(
          "Estimated fee exceeds the 0.5 test XLM sponsorship cap.",
        );
      prepared.sign(this.config.sponsor);
      // Commit the exact signed envelope/hash BEFORE any network send. Replays
      // reuse this envelope and sequence, even after a process restart.
      this.store.pending(
        job.id,
        prepared.hash().toString("hex"),
        prepared.toXDR(),
      );
      persisted = true;
      await server.sendTransaction(prepared);
    } catch (error) {
      if (!persisted)
        this.store.finish(
          job.id,
          "failed",
          null,
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Submission preparation failed.",
        );
      // A transport error after persistence is ambiguous, never a confirmed failure.
    }

    return this.reconcile(this.store.get(job.id)!);
  }

  async reconcile(job: RecordEntry): Promise<Job> {
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
      this.store.finish(job.id, "confirmed", result.ledger, null);
    } else if (result.status === "FAILED") {
      this.store.finish(
        job.id,
        "failed",
        result.ledger,
        `On-chain failure: ${result.resultXdr.toXDR("base64")}`,
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

    return jobSchema.parse(this.store.get(job.id));
  }
}
