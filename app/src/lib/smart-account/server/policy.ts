import { Address, hash, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";

export type DeploymentPolicy = {
  accountWasmHash: string;
  webauthnVerifierAddress: string;
  networkPassphrase: string;
};

export function addressCredentials(entry: xdr.SorobanAuthorizationEntry) {
  switch (entry.credentials().switch().name) {
    case "sorobanCredentialsAddress":
      return entry.credentials().address();
    case "sorobanCredentialsAddressV2":
      return entry.credentials().addressV2();
    default:
      throw new Error("Only a single address authorization is accepted.");
  }
}

// Validate the *entire* host function and auth tree, not just a method name.
export function validateDeployment(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
  account: string,
  credentialId: string,
  publicKey: Buffer,
  policy: DeploymentPolicy,
) {
  if (
    func.switch().name !== "hostFunctionTypeCreateContractV2" ||
    auth.length !== 1 ||
    publicKey.length !== 65 ||
    publicKey[0] !== 4
  )
    throw new Error("Invalid passkey deployment.");
  const credential = Buffer.from(credentialId, "base64url");

  if (
    credential.length < 16 ||
    credential.length > 512 ||
    credential.toString("base64url") !== credentialId
  ) {
    throw new Error("Invalid credential ID.");
  }

  // This is the kit's public, sign-only deployer identity, never the fee source.
  const deployer = Keypair.fromRawEd25519Seed(
    hash(Buffer.from("openzeppelin-smart-account-kit")),
  ).publicKey();

  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: Address.fromString(deployer).toScAddress(),
      salt: hash(credential),
    }),
  );

  const derived = StrKey.encodeContract(
    hash(
      xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId: hash(Buffer.from(policy.networkPassphrase)),
          contractIdPreimage: preimage,
        }),
      ).toXDR(),
    ),
  );

  const expected = new xdr.CreateContractArgsV2({
    contractIdPreimage: preimage,
    executable: xdr.ContractExecutable.contractExecutableWasm(
      Buffer.from(policy.accountWasmHash, "hex"),
    ),
    constructorArgs: [
      xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol("External"),
          Address.fromString(policy.webauthnVerifierAddress).toScVal(),
          xdr.ScVal.scvBytes(Buffer.concat([publicKey, credential])),
        ]),
      ]),
      xdr.ScVal.scvMap([]),
    ],
  });

  const root = auth[0].rootInvocation();

  if (
    derived !== account ||
    !func.createContractV2().toXDR().equals(expected.toXDR()) ||
    root.subInvocations().length !== 0 ||
    root.function().switch().name !==
      "sorobanAuthorizedFunctionTypeCreateContractV2HostFn" ||
    !root
      .function()
      .createContractV2HostFn()
      .toXDR()
      .equals(expected.toXDR()) ||
    auth[0].credentials().switch().name !== "sorobanCredentialsAddress" ||
    Address.fromScAddress(addressCredentials(auth[0]).address()).toString() !==
      deployer
  ) {
    throw new Error("Deployment is outside the Naru testnet policy.");
  }
}

export function validateSignedAuthorization(
  expectedXdr: string,
  signedXdr: string,
) {
  const expected = xdr.SorobanAuthorizationEntry.fromXDR(expectedXdr, "base64");
  const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
  const normalized = xdr.SorobanAuthorizationEntry.fromXDR(signed.toXDR());
  const signature = addressCredentials(signed).signature();

  if (signature.switch().name !== "scvMap" || !signature.map()?.length)
    throw new Error("Passkey authorization is missing.");
  addressCredentials(normalized).signature(
    addressCredentials(expected).signature(),
  );

  if (!normalized.toXDR().equals(expected.toXDR())) {
    throw new Error(
      "Authorization changed the reviewed account, nonce, expiry, or invocation.",
    );
  }

  return signed;
}
