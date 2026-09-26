import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { api } from "@naru/backend/api";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { serverKey } from "@/lib/auth/server";

export async function resolveRecipient(email: string, token: string) {
  const exact = z.email().max(254).parse(email.trim()).toLowerCase();
  const clerk = await clerkClient();

  const result = await clerk.users.getUserList({
    emailAddress: [exact],
    limit: 2,
  });

  const matches = result.data.filter(
    (user) =>
      !user.banned &&
      !user.locked &&
      user.emailAddresses.some(
        (address) =>
          address.emailAddress.toLowerCase() === exact &&
          address.verification?.status === "verified",
      ),
  );

  if (matches.length !== 1)
    throw new Error(
      "No unique, verified Naru recipient with active payments matches that exact email. Check the address with the recipient.",
    );
  const user = matches[0];

  const account = await fetchQuery(
    api.operations.recipient,
    { key: serverKey(), user: user.id },
    { token },
  );

  if (!account)
    throw new Error(
      "No unique, verified Naru recipient with active payments matches that exact email. Check the address with the recipient.",
    );

  return {
    userId: user.id,
    email: exact,
    name:
      [user.firstName, user.lastName].filter(Boolean).join(" ").slice(0, 100) ||
      exact,
    account: account.account,
  };
}
