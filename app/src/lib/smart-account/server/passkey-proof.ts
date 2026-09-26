import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { z } from "zod";

import type { Deployment, PasskeyProof } from "../payments";

const clientDataSchema = z.object({
  type: z.literal("webauthn.get"),
  challenge: z.string(),
  origin: z.string(),
  crossOrigin: z.boolean().optional(),
});

export function verifyPasskeyProof(
  proof: PasskeyProof,
  deployment: Deployment,
  challenge: string,
  origin: string,
  rpId: string,
) {
  const clientBytes = Buffer.from(proof.clientDataJSON, "base64url");

  const client = clientDataSchema.parse(
    JSON.parse(clientBytes.toString("utf8")),
  );

  const authenticator = Buffer.from(proof.authenticatorData, "base64url");
  const rpHash = createHash("sha256").update(rpId).digest();

  if (
    proof.credentialId !== deployment.credentialId ||
    client.challenge !== challenge ||
    client.origin !== origin ||
    client.crossOrigin === true ||
    authenticator.length < 37 ||
    !timingSafeEqual(authenticator.subarray(0, 32), rpHash) ||
    (authenticator[32] & 0x05) !== 0x05
  ) {
    throw new Error(
      "The passkey proof does not match this activation. Please retry.",
    );
  }

  const publicKey = Buffer.from(deployment.publicKey, "hex");

  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33, 65).toString("base64url"),
    },
  });

  const signed = Buffer.concat([
    authenticator,
    createHash("sha256").update(clientBytes).digest(),
  ]);

  if (
    !verify("sha256", signed, key, Buffer.from(proof.signature, "base64url"))
  ) {
    throw new Error(
      "Passkey ownership could not be verified. No account was linked.",
    );
  }
}
