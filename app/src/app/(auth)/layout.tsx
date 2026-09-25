import { ClerkProvider } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { SetupNotice } from "@/components/auth/SetupNotice";
import { getAuthConfig } from "@/lib/auth/config";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

export const metadata = {
  title: "Naru · Authentication",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  const config = getAuthConfig();

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm underline underline-offset-4">
        Naru home
      </Link>
      <Suspense fallback={<output>Restoring your session…</output>}>
        {config ? (
          <ClerkProvider
            dynamic
            publishableKey={config.publishableKey}
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            signInFallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
          >
            <ConvexClientProvider url={config.convexUrl}>
              {children}
            </ConvexClientProvider>
          </ClerkProvider>
        ) : (
          <SetupNotice />
        )}
      </Suspense>
    </section>
  );
}
