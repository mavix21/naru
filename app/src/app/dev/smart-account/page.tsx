import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import ValidationScreen from "@/components/smart-account/ValidationScreen";
import { gateStatus } from "@/lib/smart-account/gate";

export const metadata = {
  title: "Naru · Smart-account validation",
  robots: { index: false, follow: false },
};

async function GatedScreen() {
  // Repeat access enforcement here and in the API; Proxy is only the outer gate.
  if (gateStatus(new Headers(await headers())) !== 200) notFound();

  return <ValidationScreen />;
}

export default function SmartAccountPage() {
  return (
    <Suspense fallback={<p>Checking validation access…</p>}>
      <GatedScreen />
    </Suspense>
  );
}
