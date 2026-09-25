import { Address, Contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export function buildFundingTransfer(
  token: string,
  sponsor: string,
  account: string,
) {
  const func = new Contract(token)
    .call(
      "transfer",
      Address.fromString(sponsor).toScVal(),
      Address.fromString(account).toScVal(),
      nativeToScVal(BigInt(50_000_000), { type: "i128" }),
    )
    .body()
    .invokeHostFunctionOp()
    .hostFunction();

  // The sponsor's envelope signature authorizes this invocation, but enforcing
  // simulation still requires an explicit SOURCE_ACCOUNT entry for its tree.
  // Scope it to the single funding transfer; no separate auth signature/key.
  const auth = [
    new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            func.invokeContract(),
          ),
        subInvocations: [],
      }),
    }),
  ];

  return { func, auth };
}
