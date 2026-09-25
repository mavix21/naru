import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

import {
  gateResponse,
  gateSettings,
  gateStatus,
} from "@/lib/smart-account/gate";
import { SmartAccountService } from "@/lib/smart-account/server/service";

const account = z
  .string()
  .refine(StrKey.isValidContract, "Invalid contract address");

const encoded = z.string().min(1).max(24_000);

const requestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deploy"),
      account,
      credentialId: z.string().min(22).max(683),
      publicKey: z.string().regex(/^04[0-9a-f]{128}$/),
      payload: z
        .object({ func: encoded, auth: z.array(encoded).length(1) })
        .strict(),
    })
    .strict(),
  z.object({ action: z.literal("fund"), account }).strict(),
  z.object({ action: z.literal("review"), account }).strict(),
  z
    .object({
      action: z.literal("authorize"),
      id: z.string().uuid(),
      auth: encoded,
    })
    .strict(),
]);

function json(body: Parameters<typeof Response.json>[0], status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const access = gateStatus(request.headers);

  if (access !== 200) return gateResponse(access);
  let service: SmartAccountService | undefined;

  try {
    service = new SmartAccountService();
    service.store.rate(`read:${Math.floor(Date.now() / 60_000)}`, 180);
    const address = new URL(request.url).searchParams.get("account");

    return json(
      address
        ? await service.status(account.parse(address))
        : await service.ready(),
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Testnet request failed.",
      },
      400,
    );
  } finally {
    service?.store.close();
  }
}

export async function POST(request: Request) {
  const access = gateStatus(request.headers);

  if (access !== 200) return gateResponse(access);

  if (
    request.headers.get("origin") !== new URL(gateSettings().origin).origin ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return json({ error: "Same-origin JSON requests required." }, 403);
  let service: SmartAccountService | undefined;

  try {
    // Read with a hard bound even when Content-Length is absent/chunked.
    const reader = request.body?.getReader();

    if (!reader) return json({ error: "Missing request body." }, 400);
    let length = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      length += value.byteLength;

      if (length > 40_000) {
        await reader.cancel();

        return json({ error: "Request too large." }, 413);
      }

      chunks.push(value);
    }

    const body = requestSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );

    service = new SmartAccountService();
    service.store.rate(`write:${Math.floor(Date.now() / 60_000)}`, 30);

    switch (body.action) {
      case "deploy":
        return json(
          await service.deploy(
            body.account,
            body.credentialId,
            body.publicKey,
            body.payload,
          ),
        );
      case "fund":
        return json(await service.fund(body.account));
      case "review":
        return json(await service.review(body.account));
      case "authorize":
        return json(await service.authorize(body.id, body.auth));
    }
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Testnet request failed.",
      },
      400,
    );
  } finally {
    service?.store.close();
  }
}
