type SelectedFriend = {
  userId: string;
  start: number;
  end: number;
  label: string;
};

// Only complete, standalone send instructions take the forced tool path.
// Questions about balances, quoted examples, negations, splits, and compound
// requests remain with the normal conversational tools.
export function directTransferRequest(
  text: string,
  selected: SelectedFriend[],
) {
  const match =
    /^\s*(?:(?:please|por favor)[,\s]+)?(?:send|transfer|env[ií]a|transfiere)\s+(\d+(?:\.\d+)?)\s+(USDC|XLM)\s+(?:to|a)\s+(@[a-z0-9_]{3,24})(?:\s*,?\s*(?:please|por favor))?[.!]?\s*$/i.exec(
      text,
    );

  if (!match || selected.length > 1) return null;
  const [, amount, symbol, label] = match;
  const start = text.indexOf(label);

  const friend = selected.find(
    (mention) =>
      mention.label === label &&
      mention.start === start &&
      mention.end === start + label.length,
  );

  return {
    amount,
    asset:
      symbol.toUpperCase() === "USDC" ? ("USDC" as const) : ("XLM" as const),
    // A typed @name alone never becomes a verified recipient.
    userId: friend?.userId ?? null,
  };
}

export type DirectTransferRequest = NonNullable<
  ReturnType<typeof directTransferRequest>
>;
