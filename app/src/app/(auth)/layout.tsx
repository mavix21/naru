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
        <div className="space-y-4">
          <Suspense fallback={<AuthFormLoading />}>{children}</Suspense>
          <p className="mx-auto max-w-90 text-center text-xs leading-5 text-muted-foreground">
            Your username is your public Naru link. Your name, bio and companion
            live there; your chats and money stay private.
          </p>
        </div>
      ) : (
        <SetupNotice />
      )}
    </AuthScene>
  );
}
