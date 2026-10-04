import "server-only";
import { Address, Asset, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { z } from "zod";

import {
  readContract,
  readContractSnapshot,
  stellarRpc,
} from "../smart-account/server/rpc";
import { TESTNET } from "../smart-account/shared";
import { quoteFromRouter, quoteSchema, validateQuote } from "./policy";
import { SWAP } from "./shared";

const contractAddress = z.string().refine((value) => {
  try {
    return Address.fromString(value).toString().startsWith("C");
  } catch {
    return false;
  }
});

async function requireCode(address: string, hash?: string) {
  const entry = await stellarRpc.getContractData(
    address,
    xdr.ScVal.scvLedgerKeyContractInstance(),
  );

  const executable = entry.val.contractData().val().instance().executable();

  if (
    hash
      ? executable.switch().name !== "contractExecutableWasm" ||
        executable.wasmHash().toString("hex") !== hash
      : executable.switch().name !== "contractExecutableStellarAsset"
  )
    throw new Error(
      "The verified Testnet swap contracts changed or are unavailable. Swaps are paused.",
    );
}

export async function verifySwapMarket(source: string) {
  const read = (contract: string, method: string, args?: xdr.ScVal[]) =>
    readContract(source, contract, method, args);

  const network = await stellarRpc.getNetwork();

  if (
    network.passphrase !== TESTNET.networkPassphrase ||
    Asset.native().contractId(network.passphrase) !== SWAP.xlm ||
    new Asset("USDC", SWAP.issuer).contractId(network.passphrase) !== SWAP.usdc
  )
    throw new Error("Swap assets do not match Stellar Testnet.");
  await Promise.all([
    requireCode(SWAP.router, SWAP.routerHash),
    requireCode(SWAP.factory, SWAP.factoryHash),
    requireCode(SWAP.xlm),
    requireCode(SWAP.usdc),
  ]);

  const [factory, name, decimals] = await Promise.all([
    read(SWAP.router, "get_factory"),
    read(SWAP.usdc, "name"),
    read(SWAP.usdc, "decimals"),
  ]);

  if (
    factory !== SWAP.factory ||
    name !== `USDC:${SWAP.issuer}` ||
    decimals !== 7
  )
    throw new Error(
      "The Testnet USDC identity or swap router could not be verified.",
    );

  const assets = [
    Address.fromString(SWAP.xlm).toScVal(),
    Address.fromString(SWAP.usdc).toScVal(),
  ];

  if ((await read(SWAP.factory, "pair_exists", assets)) !== true)
    throw new Error(
      "No Soroswap liquidity pool is available for official Testnet USDC.",
    );

  const pool = contractAddress.parse(
    await read(SWAP.factory, "get_pair", assets),
  );

  await requireCode(pool, SWAP.pairHash);

  const [token0, token1, reserves, routerPool] = await Promise.all([
    read(pool, "token_0"),
    read(pool, "token_1"),
    read(pool, "get_reserves"),
    read(SWAP.router, "router_pair_for", assets),
  ]);

  if (
    routerPool !== pool ||
    !(
      (token0 === SWAP.xlm && token1 === SWAP.usdc) ||
      (token0 === SWAP.usdc && token1 === SWAP.xlm)
    )
  )
    throw new Error("The swap pool does not contain the reviewed assets.");

  const amounts = z
    .tuple([z.bigint().positive(), z.bigint().positive()])
    .safeParse(reserves);

  if (!amounts.success)
    throw new Error(
      "There is not enough liquidity for this swap. Try again later.",
    );

  return { pool, reserveOut: amounts.data[token0 === SWAP.usdc ? 0 : 1] };
}

async function requestApiQuote(amount: string) {
  const key = process.env.NARU_SOROSWAP_API_KEY;

  if (!key)
    throw new Error(
      "Swaps need NARU_SOROSWAP_API_KEY on the server. No quote is available yet.",
    );
  let response: Response;

  try {
    response = await fetch(
      "https://api.soroswap.finance/quote?network=testnet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetIn: SWAP.xlm,
          assetOut: SWAP.usdc,
          amount,
          tradeType: "EXACT_IN",
          protocols: ["soroswap"],
          maxHops: 1,
          parts: 1,
          slippageBps: SWAP.slippageBps,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch {
    throw new Error(
      "Soroswap is unavailable. No quote was prepared; please try again.",
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Soroswap API access was rejected. Check the server API key.",
      );

    if (response.status === 400) {
      const failure = z
        .object({ title: z.string(), error: z.string() })
        .safeParse(await response.json().catch(() => null));

      if (
        failure.success &&
        failure.data.title === "No path found" &&
        failure.data.error === "Quote Failed"
      )
        return null;
    }

    throw new Error(
      "Soroswap could not provide a live quote. Please try again later.",
    );
  }

  const parsed = quoteSchema.safeParse(await response.json());

  if (!parsed.success)
    throw new Error(
      "Soroswap did not return a supported direct XLM → USDC quote. No swap was prepared.",
    );

  return {
    ...validateQuote(parsed.data, amount),
    quoteSource: "soroswap_api" as const,
  };
}

export async function requestSwapQuote(amount: string, source: string) {
  const apiQuote = await requestApiQuote(amount);

  if (apiQuote) return apiQuote;

  // An empty API index is not an empty blockchain pool. The fallback is a
  // fresh Soroswap contract read, never a local price estimate or API fixture.
  const market = await verifySwapMarket(source);

  const snapshot = await readContractSnapshot(
    source,
    SWAP.router,
    "router_get_amounts_out",
    [
      nativeToScVal(BigInt(amount), { type: "i128" }),
      xdr.ScVal.scvVec([
        Address.fromString(SWAP.xlm).toScVal(),
        Address.fromString(SWAP.usdc).toScVal(),
      ]),
    ],
  );

  const amounts = z
    .tuple([z.bigint().positive(), z.bigint().positive()])
    .parse(snapshot.value);

  if (amounts[1] >= market.reserveOut)
    throw new Error("There is not enough USDC liquidity for this swap.");

  return quoteFromRouter(amounts, amount, snapshot.ledger);
}

export async function requestSwapQuoteForOutput(
  amount: string,
  source: string,
) {
  const target = BigInt(amount);
  const market = await verifySwapMarket(source);

  if (target <= BigInt(0) || target >= market.reserveOut)
    throw new Error(
      "There is not enough USDC liquidity for the requested amount.",
    );

  // Ask the verified router for the required input, including pool fees and
  // price impact. Never invert a spot price or use model-provided exchange rates.
  const snapshot = await readContractSnapshot(
    source,
    SWAP.router,
    "router_get_amounts_in",
    [
      nativeToScVal(target, { type: "i128" }),
      xdr.ScVal.scvVec([
        Address.fromString(SWAP.xlm).toScVal(),
        Address.fromString(SWAP.usdc).toScVal(),
      ]),
    ],
  );

  const units = z
    .bigint()
    .positive()
    .max((BigInt(1) << BigInt(127)) - BigInt(1));

  const amounts = z.tuple([units, units]).safeParse(snapshot.value);

  if (!amounts.success || amounts.data[1] !== target)
    throw new Error("Soroswap could not quote the requested USDC amount.");

  const amountIn = amounts.data[0].toString();
  const quote = await requestSwapQuote(amountIn, source);

  if (BigInt(quote.expectedOut) < target)
    throw new Error(
      "The price changed while quoting your USDC target. Please get a new quote.",
    );

  // Keep the existing exact-spend authorization. A successful swap must meet
  // BOTH the receive target and the normal slippage limit, never just an estimate.
  return {
    ...quote,
    amountIn,
    targetOut: amount,
    minimumOut: BigInt(quote.minimumOut) > target ? quote.minimumOut : amount,
  };
}
