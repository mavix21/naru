import type { ReactNode } from "react";

import { Suspense } from "react";

import { AuthFormLoading, AuthScene } from "@/components/auth/AuthScene";
import { SetupNotice } from "@/components/auth/SetupNotice";
import { getAuthConfig } from "@/lib/auth/config";

export const metadata = {
  title: "Naru · Authentication",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  const config = getAuthConfig();

  return (
    <AuthScene>
      {config ? (
        <Suspense fallback={<AuthFormLoading />}>{children}</Suspense>
      ) : (
        <SetupNotice />
      )}
    </AuthScene>
  );
}
