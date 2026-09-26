export const ASSET = "XLM" as const;

const SCALE = BigInt(10_000_000);

const MAX = (BigInt(1) << BigInt(127)) - BigInt(1);

export function parseAmount(value: string) {
  if (!/^(0|[1-9]\d{0,31})(\.\d{1,7})?$/.test(value))
    throw new Error(
      "Use a positive XLM amount with at most 7 decimal places, without commas or exponents.",
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
