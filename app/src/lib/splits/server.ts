import "server-only";
import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { NARU_SPLIT, TESTNET_ASSETS } from "@naru/backend/money";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { fetchMutation } from "convex/nextjs";
import { randomUUID } from "node:crypto";

import type { RecordEntry } from "../smart-account/server/store";

import { serverKey } from "../auth/key";
import { addressCredentials } from "../smart-account/server/policy";
import {
  SmartAccountService,
  stellarRpc,
} from "../smart-account/server/service";
import { TESTNET } from "../smart-account/shared";
import {
  creationFunction,
  createdSplitSchema,
  validateCreationAuthorization,
  validateCreationEnvelope,
  parseCreatedSplit,
  maintenanceFunction,
  splitStorageKey,
  validateMaintenanceEnvelope,
  type CreationIntent,
} from "./policy";

export function creationIntent(split: Doc<"splits">): CreationIntent {
  if (
    split.asset !== "USDC" ||
    split.token !== TESTNET_ASSETS.USDC ||
    split.creation?.contract !== NARU_SPLIT.contract ||
    !split.organizerAccount ||
    !split.includeSelf ||
    split.mode !== "reimburse" ||
    split.shares.some((s) => !s.account)
  )
    throw new Error("Invalid reimbursement review.");

  const intent = {
    account: split.organizerAccount,
    splitId: split.creation.id,
    units: split.units,
    participants: split.shares.map((s) => s.account!),
  };

  creationFunction(intent);

  return intent;
}

export async function requireSplitContract(service: SmartAccountService) {
  const [network, infrastructure, asset] = await Promise.all([
    stellarRpc.getNetwork(),
    stellarRpc.getLedgerEntries(
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(NARU_SPLIT.contract).toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      ),
      xdr.LedgerKey.contractCode(
        new xdr.LedgerKeyContractCode({
          hash: Buffer.from(NARU_SPLIT.wasmHash, "hex"),
        }),
      ),
    ),
    service.readContract(NARU_SPLIT.contract, "usdc"),
  ]);

  const instance = infrastructure.entries.find(
    (entry) => entry.key.switch().name === "contractData",
  );

  if (
    !instance ||
    infrastructure.entries.length !== 2 ||
    infrastructure.entries.some(
      (entry) =>
        !entry.liveUntilLedgerSeq ||
        entry.liveUntilLedgerSeq - infrastructure.latestLedger < 60,
    )
  )
    throw new Error(
      "NaruSplit infrastructure needs separate operator renewal or restoration. No user transaction was sent.",
    );

  if (
    network.passphrase !== TESTNET.networkPassphrase ||
    asset !== TESTNET_ASSETS.USDC ||
    instance.val
      .contractData()
      .val()
      .instance()
      .executable()
      .wasmHash()
      .toString("hex") !== NARU_SPLIT.wasmHash
  )
    throw new Error(
      "The pinned NaruSplit Testnet deployment is unavailable or changed.",
    );
}

export function assertCreationJob(
  service: SmartAccountService,
  job: RecordEntry,
  intent: CreationIntent,
) {
  if (
    job.kind !== "split_create" ||
    job.account !== intent.account ||
    job.func !== creationFunction(intent).toXDR("base64")
  )
    throw new Error("Publication journal does not match this split.");
  validateCreationAuthorization(
    xdr.SorobanAuthorizationEntry.fromXDR(job.auth, "base64"),
    intent,
  );

  if (job.envelope)
    validateCreationEnvelope(
      job.envelope,
      job.hash,
      service.config.publicConfig.sponsor,
      intent,
      job.auth,
      job.expires,
    );
  else if (job.state === "confirmed")
    throw new Error("Confirmed creation envelope missing.");
}

export async function reviewCreation(
  service: SmartAccountService,
  split: Doc<"splits">,
) {
  const intent = creationIntent(split);
  await requireSplitContract(service);
  await Promise.all(
    intent.participants.map((account) => service.requireAccount(account)),
  );
  const func = creationFunction(intent);

  const simulation = await stellarRpc.simulateTransaction(
    await service.transaction(func, []),
    undefined,
    "record",
    true,
  );

  if (
    !rpc.Api.isSimulationSuccess(simulation) ||
    simulation.result?.auth?.length !== 1
  )
    throw new Error(
      "Split creation could not be simulated. No requests were published.",
    );
  const entry = simulation.result.auth[0];
  validateCreationAuthorization(entry, intent);
  const expiration = simulation.latestLedger + 60;
  addressCredentials(entry).signatureExpirationLedger(expiration);
  addressCredentials(entry).signature(xdr.ScVal.scvVoid());
  const auth = entry.toXDR("base64");
  const expiresAt = Date.now() + 120_000;
  const id = randomUUID();
  await service.store.insert(
    id,
    intent.account,
    "split_create",
    func.toXDR("base64"),
    auth,
    expiresAt,
  );

  return { id, auth, expiration, expiresAt };
}

export async function reconcileCreation(
  service: SmartAccountService,
  split: Doc<"splits">,
  token: string,
) {
  if (split.state === "sent") {
    await maintainPublishedSplit(service, split);

    return;
  }

  if (
    (split.state !== "submitting" && split.state !== "published") ||
    !split.creation?.reviewId
  )
    return;
  const intent = creationIntent(split);
  let job = await service.store.get(split.creation.reviewId);

  if (!job) throw new Error("Publication journal is unavailable.");
  assertCreationJob(service, job, intent);

  if (job.state === "review" && job.expires <= Date.now()) {
    await service.store.finish(
      job.id,
      "failed",
      null,
      "Authorization interrupted before submission. Review again.",
      "review",
    );
    job = (await service.store.get(job.id))!;
  }

  const result = await service.reconcile(job);
  let verifiedLedger: number | undefined;

  let shareStates:
    | { account: string; state: "outstanding" | "paid" | "cancelled" }[]
    | undefined;

  if (result.state === "confirmed") {
    assertCreationJob(service, (await service.store.get(job.id))!, intent);
    await requireSplitContract(service);

    const state = parseCreatedSplit(
      createdSplitSchema.parse(
        await service.readContract(NARU_SPLIT.contract, "get", [
          Address.fromString(intent.account).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(intent.splitId, "hex")),
        ]),
      ),
      intent,
    );

    verifiedLedger = state.created_ledger;
    shareStates = state.shares
      .filter((s) => s.participant !== intent.account)
      .map((s) => ({
        account: s.participant,
        state:
          s.state[0] === "Paid"
            ? "paid"
            : s.state[0] === "Cancelled"
              ? "cancelled"
              : "outstanding",
      }));
  }

  await fetchMutation(
    api.splits.reportCreation,
    {
      key: serverKey(),
      id: split._id,
      revision: split.revision,
      reviewId: job.id,
      verifiedLedger,
      shareStates,
    },
    { token },
  );
}

export async function maintainPublishedSplit(
  service: SmartAccountService,
  split: Doc<"splits">,
  apply = true,
) {
  if (split.state !== "sent" || !split.creation?.hash)
    throw new Error("Only verified published splits can be maintained.");
  const intent = creationIntent(split);
  await requireSplitContract(service);
  const func = maintenanceFunction(intent);

  let job = split.maintenanceReviewId
    ? await service.store.get(split.maintenanceReviewId)
    : null;

  // Recover a saved envelope even when its successful renewal has already made
  // the entry healthy. Otherwise a lost acknowledgement could strand the sponsor.
  if (apply && job && (job.state === "pending" || job.state === "preparing")) {
    assertMaintenanceJob(service, job, intent);
    const recovered = await service.reconcile(job);

    if (recovered.state !== "confirmed" && recovered.state !== "failed")
      return { state: recovered.state, hash: recovered.hash, submitted: true };
    job = await service.store.get(job.id);
  }

  const state = parseCreatedSplit(
    createdSplitSchema.parse(
      await service.readContract(NARU_SPLIT.contract, "get", [
        Address.fromString(intent.account).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(intent.splitId, "hex")),
      ]),
    ),
    intent,
  );

  if (!state.shares.some((share) => share.state[0] === "Outstanding"))
    return { state: "terminal", submitted: false };
  const entries = await stellarRpc.getLedgerEntries(splitStorageKey(intent));
  const ttl = entries.entries[0]?.liveUntilLedgerSeq;
  // Absence alone is not evidence of archival: the successful terms-checked
  // read above must prove the original record still exists before restoration.
  const remaining = ttl === undefined ? 0 : ttl - entries.latestLedger;

  if (remaining >= 7 * 17280)
    return { state: "healthy", remainingLedgers: remaining, submitted: false };

  const simulation = await stellarRpc.simulateTransaction(
    await service.transaction(func, []),
    undefined,
    "enforce",
  );

  if (
    !rpc.Api.isSimulationSuccess(simulation) ||
    rpc.Api.isSimulationRestore(simulation) ||
    simulation.result?.auth?.length
  )
    throw new Error("Split renewal/restoration could not be simulated safely.");

  const estimatedFeeStroops = (
    BigInt(simulation.minResourceFee) + BigInt(100)
  ).toString();

  if (BigInt(estimatedFeeStroops) > BigInt(5_000_000))
    throw new Error(
      "Split maintenance exceeds the unchanged 0.5 test XLM cap. No transaction was sent.",
    );

  if (!apply)
    return {
      state: remaining > 0 ? "renewal_due" : "restoration_due",
      estimatedFeeStroops,
      remainingLedgers: remaining,
      submitted: false,
    };

  if (
    !job ||
    job.state === "confirmed" ||
    job.state === "failed" ||
    (job.state === "review" && job.expires <= Date.now())
  ) {
    const proposed = await service.store.insert(
      randomUUID(),
      intent.account,
      "split_keep_alive",
      func.toXDR("base64"),
      "[]",
      Date.now() + 180_000,
    );

    const selected = await fetchMutation(api.splits.bindMaintenance, {
      key: serverKey(),
      id: split._id,
      reviewId: proposed.id,
    });

    if (selected !== proposed.id)
      await service.store.finish(
        proposed.id,
        "failed",
        null,
        "Concurrent maintenance already exists.",
        "review",
      );
    job = await service.store.get(selected);
  }

  if (!job) throw new Error("Split maintenance journal unavailable.");
  assertMaintenanceJob(service, job, intent);

  const result =
    job.state === "review"
      ? await service.submit(job, [], (tx) =>
          validateMaintenanceEnvelope(
            tx.toXDR(),
            tx.hash().toString("hex"),
            service.config.publicConfig.sponsor,
            intent,
            job.expires,
          ),
        )
      : await service.reconcile(job);

  if (result.state === "failed")
    throw new Error(result.error ?? "Split maintenance failed.");

  if (result.state === "confirmed") {
    const renewed = await stellarRpc.getLedgerEntries(splitStorageKey(intent));

    if (
      !renewed.entries[0]?.liveUntilLedgerSeq ||
      renewed.entries[0].liveUntilLedgerSeq - renewed.latestLedger < 7 * 17280
    )
      throw new Error(
        "Confirmed renewal did not preserve the split's live storage.",
      );
  }

  return {
    state: result.state,
    hash: result.hash,
    estimatedFeeStroops,
    submitted: true,
  };
}

function assertMaintenanceJob(
  service: SmartAccountService,
  job: RecordEntry,
  intent: CreationIntent,
) {
  if (
    job.kind !== "split_keep_alive" ||
    job.account !== intent.account ||
    job.func !== maintenanceFunction(intent).toXDR("base64") ||
    job.auth !== "[]"
  )
    throw new Error(
      "Split maintenance journal does not match its immutable terms.",
    );

  if (job.envelope)
    validateMaintenanceEnvelope(
      job.envelope,
      job.hash,
      service.config.publicConfig.sponsor,
      intent,
      job.expires,
    );
}
