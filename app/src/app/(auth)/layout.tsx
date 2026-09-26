import type { ReactNode } from "react";

import { AuthScene } from "@/components/auth/AuthScene";
import { SetupNotice } from "@/components/auth/SetupNotice";
import { getAuthConfig } from "@/lib/auth/config";

export const metadata = {
  title: "Naru · Authentication",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  const config = getAuthConfig();

  return <AuthScene>{config ? children : <SetupNotice />}</AuthScene>;
}
