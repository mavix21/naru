// Only standalone instructions with an explicit amount take the forced tool
// path. Questions, negations, other assets, destinations, and compound money
// requests stay with the conversational tools for clarification.
export function directSwapRequest(text: string) {
  const instruction = text
    .trim()
    .replace(/^(?:please|por favor)[,\s]+/i, "")
    // The transfer card uses this suffix when asking to cover a USDC shortfall.
    .replace(/[.!]\s*prepare a quote for me to review[.!]?$/i, "")
    .replace(/\s*,?\s*(?:please|por favor)[.!]?$/i, "")
    .replace(/[.!]$/, "")
    .trim();

  const receive =
    /^(?:swap|exchange|convert|cambia|intercambia|convierte)\s+(?:my\s+|mis?\s+)?XLM\s+(?:for|to|into|por|a)\s+(\d+(?:\.\d+)?)\s+USDC$/i.exec(
      instruction,
    ) ??
    /^swap\s+(?:enough|as much)\s+XLM\s+(?:to (?:receive|get)|for)\s+(\d+(?:\.\d+)?)\s+USDC$/i.exec(
      instruction,
    );

  if (receive) return { amount: receive[1], amountType: "receive" as const };

  const spend =
    /^(?:swap|exchange|convert|cambia|intercambia|convierte)\s+(\d+(?:\.\d+)?)\s+XLM\s+(?:for|to|into|por|a)\s+USDC$/i.exec(
      instruction,
    );

  return spend ? { amount: spend[1], amountType: "spend" as const } : null;
}

export type DirectSwapRequest = NonNullable<
  ReturnType<typeof directSwapRequest>
>;
