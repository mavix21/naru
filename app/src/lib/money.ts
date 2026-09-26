// Stellar's native asset uses seven decimal places. Money never passes through Number.
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
