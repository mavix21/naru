import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export function transferFunction(
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

/** Defense in depth: what the browser authorizes must be what its review shows. */
export function validateTransferReview(
  entry: xdr.SorobanAuthorizationEntry,
  account: string,
  recipient: string,
  token: string,
  expiration: number,
  units = "1000000",
) {
  if (entry.credentials().switch().name !== "sorobanCredentialsAddressV2") {
    throw new Error("Expected Protocol 27+ smart-account authorization.");
  }

  const credentials = entry.credentials().addressV2();

  const expected = transferFunction(
    token,
    account,
    recipient,
    BigInt(units),
  ).invokeContract();

  const root = entry.rootInvocation();

  if (
    Address.fromScAddress(credentials.address()).toString() !== account ||
    credentials.signatureExpirationLedger() !== expiration ||
    root.subInvocations().length !== 0 ||
    root.function().switch().name !==
      "sorobanAuthorizedFunctionTypeContractFn" ||
    !root.function().contractFn().toXDR().equals(expected.toXDR())
  ) {
    throw new Error(
      "Passkey authorization does not match the displayed transfer.",
    );
  }
}
