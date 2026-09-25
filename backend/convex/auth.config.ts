import type { AuthConfig } from "convex/server";

const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!domain || !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(domain)) {
  throw new Error(
    "Set CLERK_JWT_ISSUER_DOMAIN on the Convex deployment to the Clerk DEVELOPMENT Frontend API URL (https://…clerk.accounts.dev, no trailing slash).",
  );
}

export default {
  providers: [{ domain, applicationID: "convex" }],
} satisfies AuthConfig;
