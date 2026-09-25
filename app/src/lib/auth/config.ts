import "server-only";

export function getAuthConfig() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  // Use the same Clerk DEVELOPMENT instance locally and on Vercel.
  // An unconfigured checkout can still render the public homepage.
  if (
    !publishableKey?.startsWith("pk_test_") ||
    !secretKey?.startsWith("sk_test_") ||
    !convexUrl
  ) {
    return null;
  }

  return { publishableKey, convexUrl };
}
