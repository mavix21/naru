import "server-only";
import type { FunctionReturnType } from "convex/server";

import { auth } from "@clerk/nextjs/server";
import { api } from "@naru/backend/api";
import { xdr } from "@stellar/stellar-sdk";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import {
  deploymentSchema,
  passkeyProofSchema,
  type PaymentState,
} from "../payments";
import { TESTNET } from "../shared";
import { verifyPasskeyProof } from "./passkey-proof";
import { validateDeployment } from "./policy";
import { SmartAccountService } from "./service";

const attempt = z.string().uuid();

const device = z.string().uuid();

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), device }).strict(),
  z.object({ action: z.literal("start"), attempt, device }).strict(),
  z.object({ action: z.literal("cancel"), attempt, device }).strict(),
  z
    .object({
      action: z.literal("challenge"),
      attempt,
      device,
      deployment: deploymentSchema,
    })
    .strict(),
  z
    .object({ action: z.literal("verify"), attempt, proof: passkeyProofSchema })
    .strict(),
  z.object({ action: z.literal("resume") }).strict(),
]);

type Enrollment = FunctionReturnType<typeof api.payments.enrollment>;

type ReportedState = Exclude<PaymentState["state"], "inactive">;

function json(body: Parameters<typeof Response.json>[0], status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function paymentsKey() {
  const key = process.env.NARU_PAYMENTS_KEY;

  if (!key || key.length < 32)
    throw new Error(
      "Payment state is not configured. Set NARU_PAYMENTS_KEY on the app and the Convex deployment.",
    );

  return key;
}

function getEnrollment(token: string) {
  return fetchQuery(api.payments.enrollment, {}, { token });
}

function update(
  token: string,
  action:
    | { kind: "start"; attempt: string; device: string }
    | { kind: "cancel"; attempt: string; device: string }
    | { kind: "challenge"; attempt: string; device: string; deployment: string }
    | {
        kind: "link";
        attempt: string;
        challenge: string;
        deployment: string;
        account: string;
        credentialId: string;
        publicKey: string;
      }
    | {
        kind: "report";
        state: ReportedState;
        account: string | null;
        balance: string | null;
        balanceError: string | null;
        job: {
          state: string;
          hash: string | null;
          error: string | null;
        } | null;
      },
) {
  return fetchMutation(
    api.payments.apply,
    { key: paymentsKey(), action },
    { token },
  );
}

async function report(token: string, state: PaymentState) {
  if (state.state === "inactive") return;

  await update(token, {
    kind: "report",
    state: state.state,
    account: state.account,
    balance: state.balance,
    balanceError: state.balanceError,
    job: state.job
      ? {
          state: state.job.state,
          hash: state.job.hash,
          error: state.job.error,
        }
      : null,
  });
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();

  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > 40_000) {
      await reader.cancel();
      throw new Error("Request too large.");
    }

    chunks.push(value);
  }

  return inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

async function status(
  service: SmartAccountService,
  token: string,
  current: Enrollment | null,
): Promise<PaymentState> {
  const empty = { account: null, balance: null, balanceError: null, job: null };
  const enrollment = current ?? (await getEnrollment(token));

  if (!enrollment) return { ...empty, state: "inactive" };

  if (!enrollment.account) {
    const pending: PaymentState = { ...empty, state: "passkey" };
    await report(token, pending);

    return pending;
  }

  const account = await service.status(enrollment.account);
  const job = account.jobs.find((item) => item.kind === "deploy") || null;

  const state: PaymentState = {
    state: account.deployed
      ? "ready"
      : job?.state === "failed"
        ? "rejected"
        : "pending",
    account: enrollment.account,
    balance: account.balance,
    balanceError: account.balanceError || null,
    job,
  };

  await report(token, state);

  return state;
}

async function resume(
  service: SmartAccountService,
  token: string,
  current: Enrollment | null,
): Promise<PaymentState> {
  const enrollment = current ?? (await getEnrollment(token));

  if (!enrollment?.account || !enrollment.deployment)
    throw new Error("Confirm your passkey to continue activation.");
  const deployment = deploymentSchema.parse(JSON.parse(enrollment.deployment));
  await service.resumeVerifiedDeployment(deployment);

  return status(service, token, enrollment);
}

async function handle(request: Request) {
  let service: SmartAccountService | undefined;

  try {
    const session = await auth();

    if (!session.userId)
      return json({ error: "Sign in to manage payments." }, 401);

    // Reject work started by a different signed-in user before an account
    // switch. This header is only a comparison; Clerk remains the authority.
    if (request.headers.get("X-Naru-User") !== session.userId) {
      return json(
        { error: "Your session changed. Refresh before continuing." },
        409,
      );
    }

    const origin = new URL(
      process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000",
    );

    const local =
      process.env.NODE_ENV === "development" && origin.hostname === "localhost";

    // The user-facing endpoint uses Clerk, while retaining the explicit testnet
    // enable switch, exact host/origin, persistent store, and sponsor budgets.
    if (
      request.headers.get("host") !== origin.host ||
      (!local &&
        (process.env.NARU_SMART_ACCOUNT_ENABLED !== "true" ||
          origin.protocol !== "https:"))
    ) {
      return json(
        { error: "Payment activation is not enabled on this host." },
        503,
      );
    }

    if (
      request.method === "POST" &&
      (request.headers.get("origin") !== origin.origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json")
    ) {
      return json({ error: "Same-origin JSON requests required." }, 403);
    }

    // Match ConvexProviderWithClerk: the configured Clerk integration already
    // includes aud=convex; older instances use the named JWT template instead.
    const token =
      session.sessionClaims?.aud === "convex"
        ? await session.getToken()
        : await session.getToken({ template: "convex" });

    if (!token)
      return json(
        { error: "Your session is still loading. Please retry." },
        401,
      );
    const companion = await fetchQuery(api.companions.current, {}, { token });

    if (!companion)
      return json(
        { error: "Save your companion before activating payments." },
        403,
      );
    service = new SmartAccountService();
    service.store.rate(
      `${request.method === "GET" ? "read" : "write"}:${Math.floor(Date.now() / 60_000)}`,
      request.method === "GET" ? 180 : 30,
    );
    service.store.rate(
      `payments:${request.method}:${session.userId}:${Math.floor(Date.now() / 60_000)}`,
      60,
    );

    if (request.method === "GET") {
      return json(
        new URL(request.url).searchParams.get("view") === "config"
          ? await service.ready()
          : await status(service, token, null),
      );
    }

    const body = await readBody(request);

    switch (body.action) {
      case "begin":
        return json(
          await fetchMutation(
            api.payments.apply,
            {
              key: paymentsKey(),
              action: { kind: "reserve", device: body.device },
            },
            { token },
          ),
        );
      case "start":
        await update(token, {
          kind: "start",
          attempt: body.attempt,
          device: body.device,
        });

        return json({ ok: true });
      case "cancel":
        await update(token, {
          kind: "cancel",
          attempt: body.attempt,
          device: body.device,
        });

        return json({ ok: true });
      case "challenge": {
        const deployment = body.deployment;
        validateDeployment(
          xdr.HostFunction.fromXDR(deployment.payload.func, "base64"),
          deployment.payload.auth.map((entry) =>
            xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64"),
          ),
          deployment.account,
          deployment.credentialId,
          Buffer.from(deployment.publicKey, "hex"),
          TESTNET,
        );

        // A credential that already belongs to an earlier sponsored account
        // cannot be imported into this user's onboarding.
        if (service.store.accountJobs(deployment.account).length)
          throw new Error(
            "This credential belongs to an earlier account. It cannot be imported into onboarding.",
          );

        return json(
          await update(token, {
            kind: "challenge",
            attempt: body.attempt,
            device: body.device,
            deployment: JSON.stringify(deployment),
          }),
        );
      }

      case "verify": {
        const current = await getEnrollment(token);

        if (!current) throw new Error("This activation attempt was not found.");

        if (current.account) return json(await resume(service, token, current));

        if (
          !current.candidate ||
          !current.challenge ||
          !current.expires ||
          current.expires <= Date.now()
        ) {
          throw new Error("Passkey confirmation expired. Please retry.");
        }

        const deployment = deploymentSchema.parse(
          JSON.parse(current.candidate),
        );

        verifyPasskeyProof(
          body.proof,
          deployment,
          current.challenge,
          service.config.publicConfig.origin,
          service.config.publicConfig.rpId,
        );
        await update(token, {
          kind: "link",
          attempt: current.attempt,
          challenge: current.challenge,
          deployment: current.candidate,
          account: deployment.account,
          credentialId: deployment.credentialId,
          publicKey: deployment.publicKey,
        });

        return json(await resume(service, token, await getEnrollment(token)));
      }

      case "resume":
        return json(await resume(service, token, null));
    }
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 600)
            : "Payments are unavailable. Please retry.",
      },
      400,
    );
  } finally {
    service?.store.close();
  }
}

export const GET = handle;

export const POST = handle;
