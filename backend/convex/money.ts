export const ASSET = "XLM" as const;

export type TransferAsset = "XLM" | "USDC";

// The verified Testnet SAC identities originally pinned by the swap flow.
// Both assets use seven decimals on Stellar (including USDC).
export const TESTNET_ASSETS = {
  XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
} as const;

export const NARU_SPLIT = {
  contract: "CCGF3HL4GCL37O2ZCCU6ZJRU5EEUGFRMZEV46BHKF5767ZYPY4BM6R76",
  wasmHash: "ea4d32725fdfe63004095990dbe05ab13f84b24328891a04412f256a9b2fe0d8",
  maxParticipants: 13,
} as const;

// All Naru participants are verified C-addresses. Comparing the numeric base32
// digits of same-version StrKeys is equivalent to comparing their 32-byte IDs
// (the checksum follows the ID). JS string/locale order is NOT Soroban order.
export function contractShares(total: string, accounts: string[]) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  if (
    accounts.length < 2 ||
    accounts.length > NARU_SPLIT.maxParticipants ||
    new Set(accounts).size !== accounts.length ||
    accounts.some((account) => !/^C[A-Z2-7]{55}$/.test(account))
  )
    throw new Error(
      "Choose 2–13 distinct activated smart accounts, including yourself.",
    );

  const ordered = [...accounts].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      const difference = alphabet.indexOf(a[i]) - alphabet.indexOf(b[i]);

      if (difference) return difference;
    }

    return 0;
  });

  const units = BigInt(parseAmount(total, "USDC").units);
  const count = BigInt(ordered.length);

  if (units < count)
    throw new Error(
      "The total must cover at least one smallest unit per person.",
    );

  return ordered.map((account, index) => ({
    account,
    units: (
      units / count +
      (BigInt(index) < units % count ? BigInt(1) : BigInt(0))
    ).toString(),
  }));
}

export function assertTransferAmount(value: {
  asset: TransferAsset;
  token: string;
  amount: string;
  units: string;
}) {
  const parsed = parseAmount(value.amount, value.asset);

  if (
    value.token !== TESTNET_ASSETS[value.asset] ||
    parsed.units !== value.units ||
    parsed.amount !== value.amount
  )
    throw new Error("The asset or amount does not match the saved transfer.");
}

export function transferShortfall(units: string, balance: string | null) {
  if (balance === null) return null;
  const missing = BigInt(units) - BigInt(balance);

  return missing > BigInt(0) ? displayAmount(missing.toString()) : "0";
}

const SCALE = BigInt(10_000_000);

const MAX = (BigInt(1) << BigInt(127)) - BigInt(1);

export function parseAmount(value: string, asset: "XLM" | "USDC" = ASSET) {
  if (!/^(0|[1-9]\d{0,31})(\.\d{1,7})?$/.test(value))
    throw new Error(
      `Use a positive ${asset} amount with at most 7 decimal places, without commas or exponents.`,
    );
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(7, "0"));

  if (units <= BigInt(0) || units > MAX)
    throw new Error("This amount is outside the supported range.");

  return { units: units.toString(), amount: displayAmount(units.toString()) };
}

export function displayAmount(raw: string) {
  const value = BigInt(raw);

  const fraction = (value % SCALE)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");

  return `${value / SCALE}${fraction ? `.${fraction}` : ""}`;
}

// Immutable-ID order determines who receives each remaining smallest unit.
export function equalShares<T extends string>(total: string, ids: T[]) {
  const ordered = [...new Set(ids)].sort();

  if (!ordered.length || ordered.length !== ids.length)
    throw new Error("Choose distinct participants.");
  const units = BigInt(parseAmount(total).units);
  const count = BigInt(ordered.length);

  if (units < count)
    throw new Error(
      "The total must cover at least one smallest unit per person.",
    );

  return ordered.map((userId, index) => ({
    userId,
    units: (
      units / count +
      (BigInt(index) < units % count ? BigInt(1) : BigInt(0))
    ).toString(),
  }));
}
