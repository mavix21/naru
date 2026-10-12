import "server-only";
import type { Doc } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  rpc,
  scValToBigInt,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { createHash, randomBytes } from "node:crypto";

import { serverKey } from "@/lib/auth/key";
import { displayAmount, parseAmount, TESTNET_ASSETS } from "@/lib/money";
import { stellarRpc } from "@/lib/smart-account/server/rpc";
import { SmartAccountService } from "@/lib/smart-account/server/service";
import { transferFunction } from "@/lib/smart-account/transfer";

import { TIP, type TipReview, type TipStatus } from "./shared";

type Tip = Doc<"tips">;

const USDC = new Asset("USDC", TESTNET_ASSETS.usdcIssuer);

const BASE_RESERVE = BigInt(5_000_000);

const TRUSTLINE_MAX_FEE = "100000"; // 0.01 XLM

// The browser keeps the raw capability; Convex stores only its digest.
function digest(checkout: string) {
  return createHash("sha256").update(checkout).digest("hex");
}

function readTransaction(envelope: string) {
  const transaction = TransactionBuilder.fromXDR(
    envelope,
    TIP.networkPassphrase,
  );

  if (!(transaction instanceof Transaction))
    throw new Error("Fee-bump envelopes aren’t supported for tips.");

  return transaction;
}

// SAC transfer data is an i128, or a map with `amount` for muxed recipients.
function eventAmount(data: xdr.ScVal) {
  if (data.switch().name === "scvI128") return scValToBigInt(data);

  const amount = data
    .map()
    ?.find(
      (entry) =>
        entry.key().switch().name === "scvSymbol" &&
        entry.key().sym().toString() === "amount",
    );

  return amount ? scValToBigInt(amount.val()) : null;
}

function sameXdr(a: { toXDR(): Buffer }, b: { toXDR(): Buffer }) {
  return a.toXDR().equals(b.toXDR());
}

/**
 * The unsigned body must be exactly one direct USDC SAC transfer from the
 * payer's classic account to the bound smart account, authorized by the
 * transaction source itself (no separate auth-entry signing).
 */
function assertTipTransaction(
  tx: Transaction,
  terms: {
    sender: string;
    recipient: string;
    units: string;
    maxTime: number;
  },
) {
  const op = tx.operations[0];

  const func = transferFunction(
    TESTNET_ASSETS.USDC,
    terms.sender,
    terms.recipient,
    BigInt(terms.units),
  );

  if (
    tx.source !== terms.sender ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "none" ||
    tx.timeBounds?.minTime !== "0" ||
    Number(tx.timeBounds.maxTime) !== terms.maxTime ||
    BigInt(tx.fee) > BigInt(TIP.maxFeeStroops) ||
    op.type !== "invokeHostFunction" ||
    (op.source !== undefined && op.source !== terms.sender) ||
    !sameXdr(op.func, func) ||
    op.auth?.length !== 1
  )
    throw new Error("This transaction doesn’t match the reviewed tip.");

  const entry = op.auth[0];
  const root = entry.rootInvocation();

  if (
    entry.credentials().switch().name !== "sorobanCredentialsSourceAccount" ||
    root.subInvocations().length !== 0 ||
    root.function().switch().name !==
      "sorobanAuthorizedFunctionTypeContractFn" ||
    !sameXdr(root.function().contractFn(), func.invokeContract())
  )
    throw new Error("This transaction requests unexpected authorization.");
}

function availableLumens(entry: xdr.AccountEntry) {
  let subentries = BigInt(entry.numSubEntries());
  let selling = BigInt(0);
  const ext = entry.ext();

  if (ext.switch() === 1) {
    const v1 = ext.v1();
    selling = BigInt(v1.liabilities().selling().toString());

    if (v1.ext().switch() === 2) {
      const v2 = v1.ext().v2();
      subentries += BigInt(v2.numSponsoring() - v2.numSponsored());
    }
  }

  return (
    BigInt(entry.balance().toString()) -
    (BigInt(2) + subentries) * BASE_RESERVE -
    selling
  );
}

function submissionError(result?: xdr.TransactionResult) {
  switch (result?.result().switch().name) {
    case "txBadSeq":
      return "Your wallet’s account changed after this review (another transaction was sent). Nothing was sent; start a new tip.";
    case "txInsufficientBalance":
    case "txInsufficientFee":
      return "Not enough test XLM to cover the network fee. Nothing was sent.";
    case "txBadAuth":
    case "txBadAuthExtra":
      return "The wallet’s signature wasn’t accepted by the network. Nothing was sent.";
    case "txTooLate":
      return "This review expired before reaching the network. Nothing was sent.";
    default:
      return "The network rejected this tip before it was processed. Nothing was sent.";
  }
}

export class TipError extends Error {
  constructor(
    readonly reason: "usdc_trustline",
    message: string,
  ) {
    super(message);
  }
}

async function usdcTrustline(account: string) {
  try {
    const line = await stellarRpc.getTrustline(account, USDC);

    if (!(line.flags() & 1))
      throw new Error(
        "Testnet USDC isn’t authorized for this wallet, so it can’t send a tip.",
      );

    return "ready";
  } catch (error) {
    if (error instanceof Error && /^Trustline .* not found/.test(error.message))
      return "missing";

    if (error instanceof Error && /authorized/.test(error.message)) throw error;

    throw new Error(
      "Couldn’t check this wallet’s USDC on Stellar Testnet. Please try again.",
    );
  }
}

/** Exactly one default-limit USDC trustline for the payer, signed by them. */
function assertTrustlineTransaction(tx: Transaction, sender: string) {
  const op = tx.operations[0];

  if (
    tx.source !== sender ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "none" ||
    BigInt(tx.fee) > BigInt(TRUSTLINE_MAX_FEE) ||
    Number(tx.timeBounds?.maxTime) * 1000 > Date.now() + TIP.lifetimeMs ||
    Number(tx.timeBounds?.maxTime) * 1000 <= Date.now() ||
    op.type !== "changeTrust" ||
    (op.source !== undefined && op.source !== sender) ||
    !(op.line instanceof Asset) ||
    !op.line.equals(USDC) ||
    op.limit !== "922337203685.4775807"
  )
    throw new Error(
      "The wallet returned a different transaction than adding USDC. Nothing was sent.",
    );

  const payer = Keypair.fromPublicKey(sender);

  if (
    !tx.signatures.some(
      (signature) =>
        signature.hint().equals(payer.signatureHint()) &&
        payer.verify(tx.hash(), signature.signature()),
    )
  )
    throw new Error(
      "This transaction wasn’t signed by the connected wallet. Nothing was sent.",
    );
}

export class TipService {
  key = serverKey();
  private service?: SmartAccountService;

  // Reused for the pinned USDC identity and the recipient's deployment checks.
  private get accounts() {
    return (this.service ??= new SmartAccountService());
  }

  async available(username: string) {
    const recipient = await fetchQuery(api.tips.recipient, {
      key: this.key,
      username,
    });

    return recipient?.available === true;
  }

  // One-time setup: the payer's wallet signs a USDC trustline that Naru
  // prepares, then Naru verifies and submits it. No funds move.
  async trustline(sender: string) {
    if (!StrKey.isValidEd25519PublicKey(sender))
      throw new Error("Connect a Stellar account (G…) to send a tip.");

    let account: xdr.AccountEntry;

    try {
      account = await stellarRpc.getAccountEntry(sender);
    } catch {
      throw new Error(
        "This wallet isn’t active on Stellar Testnet yet. Fund it with Friendbot, then try again.",
      );
    }

    if ((await usdcTrustline(sender)) === "ready")
      return { state: "ready" as const };

    // The new trustline raises the account's minimum balance by one reserve.
    if (availableLumens(account) < BASE_RESERVE + BigInt(TRUSTLINE_MAX_FEE))
      throw new Error(
        "Adding USDC needs about 0.51 free test XLM in this wallet. Add test XLM and try again.",
      );

    const transaction = new TransactionBuilder(
      new Account(sender, account.seqNum().toString()),
      { fee: BASE_FEE, networkPassphrase: TIP.networkPassphrase },
    )
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimebounds(0, Math.floor((Date.now() + TIP.lifetimeMs) / 1000))
      .build();

    return {
      state: "sign" as const,
      xdr: transaction.toXDR(),
      networkPassphrase: TIP.networkPassphrase,
    };
  }

  async trust(sender: string, signedXdr: string) {
    let signed: Transaction;

    try {
      signed = readTransaction(signedXdr);
    } catch {
      throw new Error(
        "The wallet returned a transaction Naru can’t read. Nothing was sent.",
      );
    }

    assertTrustlineTransaction(signed, sender);

    const hash = signed.hash().toString("hex");
    const sent = await stellarRpc.sendTransaction(signed);

    if (sent.status === "ERROR") {
      if ((await usdcTrustline(sender)) === "ready")
        return { state: "ready" as const, hash };

      const code = sent.errorResult?.result().switch().name;

      throw new Error(
        code === "txBadSeq"
          ? "Your wallet sent another transaction meanwhile. Try adding USDC again."
          : code === "txInsufficientBalance" || code === "txInsufficientFee"
            ? "Not enough test XLM to add USDC. Nothing was sent."
            : "Stellar Testnet rejected adding USDC. Nothing was sent.",
      );
    }

    // Testnet closes a ledger about every five seconds.
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await stellarRpc.getTransaction(hash);

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS)
        return { state: "ready" as const, hash };

      if (result.status === rpc.Api.GetTransactionStatus.FAILED)
        throw new Error(
          "Stellar Testnet rejected adding USDC. Only the network fee may have been charged.",
        );

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    return { state: "pending" as const, hash };
  }

  async prepare(input: {
    username: string;
    sender: string;
    amount: string;
  }): Promise<TipReview> {
    if (!StrKey.isValidEd25519PublicKey(input.sender))
      throw new Error("Connect a Stellar account (G…) to send a tip.");

    const { units, amount } = parseAmount(input.amount, "USDC");

    if (
      BigInt(units) < BigInt(parseAmount(TIP.minimum, "USDC").units) ||
      BigInt(units) > BigInt(parseAmount(TIP.maximum, "USDC").units)
    )
      throw new Error(
        `Tips can be between ${TIP.minimum} and ${TIP.maximum} USDC.`,
      );

    const recipient = await fetchQuery(api.tips.recipient, {
      key: this.key,
      username: input.username,
    });

    if (!recipient?.available)
      throw new Error("This profile can’t receive tips yet.");

    await this.accounts.requireAccount(recipient.account);

    let account: xdr.AccountEntry;

    try {
      account = await stellarRpc.getAccountEntry(input.sender);
    } catch {
      throw new Error(
        "This wallet isn’t active on Stellar Testnet yet. Fund it with Friendbot, add a USDC trustline, then try again.",
      );
    }

    // A missing trustline is a fixable checkout step, not a dead end.
    if ((await usdcTrustline(input.sender)) === "missing")
      throw new TipError(
        "usdc_trustline",
        "Your wallet needs to add USDC before it can send a tip.",
      );

    // Also verifies the pinned SAC is the official Testnet USDC.
    const balance = await this.accounts.usdcBalance(input.sender);

    if (BigInt(balance) < BigInt(units))
      throw new Error(
        `This wallet has ${displayAmount(balance)} USDC. Choose a smaller tip, or get free Testnet USDC at faucet.circle.com.`,
      );

    const maxTime = Math.floor((Date.now() + TIP.lifetimeMs) / 1000);

    const transaction = new TransactionBuilder(
      new Account(input.sender, account.seqNum().toString()),
      { fee: BASE_FEE, networkPassphrase: TIP.networkPassphrase },
    )
      .addOperation(
        Operation.invokeHostFunction({
          func: transferFunction(
            TESTNET_ASSETS.USDC,
            input.sender,
            recipient.account,
            BigInt(units),
          ),
          auth: [],
        }),
      )
      .setTimebounds(0, maxTime)
      .build();

    const simulation = await stellarRpc.simulateTransaction(transaction);

    if (!rpc.Api.isSimulationSuccess(simulation))
      throw new Error(
        "Stellar Testnet couldn’t simulate this tip. Check your USDC balance and try again; nothing was sent.",
      );

    const prepared = rpc.assembleTransaction(transaction, simulation).build();
    const terms = { sender: input.sender, recipient: recipient.account, units };
    assertTipTransaction(prepared, { ...terms, maxTime });

    const shortfall = BigInt(prepared.fee) - availableLumens(account);

    if (shortfall > BigInt(0))
      throw new Error(
        `You need about ${displayAmount(shortfall.toString())} more test XLM for the network fee.`,
      );

    const checkout = randomBytes(32).toString("base64url");
    const hash = prepared.hash().toString("hex");
    // Leave time to submit inside the transaction's own time bounds.
    const expiresAt = maxTime * 1000 - 30_000;

    await fetchMutation(api.tips.create, {
      key: this.key,
      checkout: digest(checkout),
      username: recipient.username,
      recipientAccount: recipient.account,
      sender: input.sender,
      amount,
      units,
      fee: prepared.fee,
      envelope: prepared.toXDR(),
      hash,
      expiresAt,
    });

    return {
      checkout,
      recipient: {
        username: recipient.username,
        displayName: recipient.displayName,
        account: recipient.account,
      },
      sender: input.sender,
      network: TIP.network,
      networkPassphrase: TIP.networkPassphrase,
      asset: "USDC",
      issuer: TESTNET_ASSETS.usdcIssuer,
      amount,
      fee: displayAmount(prepared.fee),
      xdr: prepared.toXDR(),
      hash,
      expiresAt,
    };
  }

  private async find(checkout: string) {
    const tip = await fetchQuery(api.tips.get, {
      key: this.key,
      checkout: digest(checkout),
    });

    if (!tip) throw new Error("This tip checkout wasn’t found.");

    return tip;
  }

  private finish(
    checkout: string,
    expected: "review" | "pending",
    state: "confirmed" | "failed",
    details: { ledger?: number; error?: string } = {},
  ) {
    return fetchMutation(api.tips.finish, {
      key: this.key,
      checkout: digest(checkout),
      expected,
      state,
      ...details,
    });
  }

  async submit(checkout: string, signedXdr: string): Promise<TipStatus> {
    const tip = await this.find(checkout);

    if (tip.state !== "review") return this.status(checkout);

    if (tip.expiresAt <= Date.now()) {
      await this.finish(checkout, "review", "failed", {
        error: "This review expired before it was signed. Nothing was sent.",
      });

      return this.status(checkout);
    }

    let signed: Transaction;

    try {
      signed = readTransaction(signedXdr);
    } catch {
      throw new Error(
        "The wallet returned a transaction Naru can’t read. Nothing was sent.",
      );
    }

    // The hash commits to network, source, sequence, fee, time bounds and the
    // exact operation; only signatures may differ from the reviewed envelope.
    if (signed.hash().toString("hex") !== tip.hash)
      throw new Error(
        "The wallet returned a different transaction than the one you reviewed (account, network or terms changed). Nothing was sent.",
      );

    const reviewed = readTransaction(tip.envelope);

    assertTipTransaction(signed, {
      sender: tip.sender,
      recipient: tip.recipientAccount,
      units: tip.units,
      maxTime: Number(reviewed.timeBounds?.maxTime),
    });

    const payer = Keypair.fromPublicKey(tip.sender);

    if (
      signed.signatures.length > 20 ||
      !signed.signatures.some(
        (signature) =>
          signature.hint().equals(payer.signatureHint()) &&
          payer.verify(signed.hash(), signature.signature()),
      )
    )
      throw new Error(
        "This transaction wasn’t signed by the reviewed wallet. Nothing was sent.",
      );

    const { claimed } = await fetchMutation(api.tips.submit, {
      key: this.key,
      checkout: digest(checkout),
      signedEnvelope: signed.toXDR(),
    });

    if (claimed) {
      try {
        const sent = await stellarRpc.sendTransaction(signed);

        // First send of a never-submitted envelope: ERROR is a definite rejection.
        if (sent.status === "ERROR")
          await this.finish(checkout, "pending", "failed", {
            error: submissionError(sent.errorResult),
          });
      } catch {
        // Ambiguous transport failure: the persisted envelope stays pending.
      }
    }

    return this.status(checkout);
  }

  async status(checkout: string): Promise<TipStatus> {
    let tip = await this.find(checkout);

    if (tip.state === "review" && tip.expiresAt <= Date.now())
      tip = await this.finish(checkout, "review", "failed", {
        error: "This review expired before it was signed. Nothing was sent.",
      });
    else if (tip.state === "pending") {
      try {
        tip = await this.reconcile(checkout, tip);
      } catch {
        tip = {
          ...tip,
          error:
            "Confirmation is temporarily unavailable. Your tip is still pending — don’t send it again.",
        };
      }
    }

    return {
      checkout,
      state: tip.state,
      amount: tip.amount,
      sender: tip.sender,
      recipient: tip.recipientAccount,
      fee: displayAmount(tip.fee),
      hash: tip.hash,
      ledger: tip.ledger ?? null,
      error: tip.error ?? null,
      expiresAt: tip.expiresAt,
    };
  }

  private async reconcile(checkout: string, tip: Tip): Promise<Tip> {
    if (!tip.signedEnvelope) return tip;
    const result = await stellarRpc.getTransaction(tip.hash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      if (!this.verifyTransfer(result, tip)) {
        await fetchMutation(api.tips.note, {
          key: this.key,
          checkout: digest(checkout),
          error:
            "The network confirmed this transaction, but Naru couldn’t verify the exact USDC transfer. Don’t send it again; keep this hash.",
        });

        return (await this.find(checkout))!;
      }

      return this.finish(checkout, "pending", "confirmed", {
        ledger: result.ledger,
      });
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED)
      return this.finish(checkout, "pending", "failed", {
        ledger: result.ledger,
        error:
          "Stellar Testnet rejected this tip. No USDC moved; the network fee may still have been charged.",
      });

    const signed = readTransaction(tip.signedEnvelope);

    const maxTime = Number(signed.timeBounds?.maxTime);
    const createdAt = maxTime - TIP.lifetimeMs / 1000;

    if (Date.now() / 1000 <= maxTime) {
      // Safe after an ambiguous send: identical hash, sequence and signature.
      try {
        await stellarRpc.sendTransaction(signed);
      } catch {
        // Remain pending; the next status check retries confirmation.
      }

      return tip;
    }

    // NOT_FOUND is only conclusive when RPC history covers the entire window in
    // which this envelope could have been included.
    if (
      result.oldestLedgerCloseTime <= createdAt &&
      result.latestLedgerCloseTime > maxTime + 10
    )
      return this.finish(checkout, "pending", "failed", {
        error:
          "This tip expired before reaching the network. Nothing was sent; you can start a new one.",
      });

    await fetchMutation(api.tips.note, {
      key: this.key,
      checkout: digest(checkout),
      error:
        "Confirmation is still unknown. Don’t send this tip again; keep this transaction hash.",
    });

    return (await this.find(checkout))!;
  }

  // Independent of RPC "SUCCESS": the exact envelope and exactly one USDC
  // transfer event from payer to recipient for the reviewed amount.
  private verifyTransfer(
    result: rpc.Api.GetSuccessfulTransactionResponse,
    tip: Tip,
  ) {
    try {
      const envelope = readTransaction(result.envelopeXdr.toXDR("base64"));

      if (
        result.feeBump ||
        envelope.hash().toString("hex") !== tip.hash ||
        result.resultXdr.result().switch().name !== "txSuccess"
      )
        return false;

      const transfers = (result.events?.contractEventsXdr ?? [])
        .flat()
        .filter((event) => {
          const id = event.contractId();
          const topics = event.body().v0().topics();

          return (
            id &&
            Address.fromScAddress(
              xdr.ScAddress.scAddressTypeContract(id),
            ).toString() === TESTNET_ASSETS.USDC &&
            topics[0]?.switch().name === "scvSymbol" &&
            topics[0].sym().toString() === "transfer"
          );
        });

      if (transfers.length !== 1) return false;
      const body = transfers[0].body().v0();
      const [, from, to] = body.topics();

      return (
        Address.fromScVal(from).toString() === tip.sender &&
        Address.fromScVal(to).toString() === tip.recipientAccount &&
        eventAmount(body.data()) === BigInt(tip.units)
      );
    } catch {
      return false;
    }
  }
}
