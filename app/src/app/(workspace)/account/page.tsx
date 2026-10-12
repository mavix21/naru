import { api } from "@naru/backend/api";
import { preloadQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AccountPanel } from "@/components/conversation/AccountPanel";
import { AccountFrame } from "@/components/profile/AccountFrame";
import { WalletSkeleton } from "@/components/profile/AccountSkeletons";
import { getAuthConfig } from "@/lib/auth/config";
import { sessionIdentity } from "@/lib/auth/server";

export default function Page() {
  return (
    <AccountFrame section="wallet">
      <div className="max-w-xl rounded-3xl border bg-card p-6 text-sm md:p-8">
        <div className="min-h-56">
          <Suspense fallback={<WalletSkeleton />}>
            <Wallet />
          </Suspense>
        </div>
      </div>
    </AccountFrame>
  );
}

async function Wallet() {
  "use cache: private";

  // Keep the rendered tab in this session's router cache. Convex still supplies
  // live balances, and this private output is never stored in a shared cache.
  cacheLife({ stale: 300 });

  if (!getAuthConfig()) redirect("/home");
  const session = await sessionIdentity();

  if (!session) redirect("/sign-in");

  // Private balances remain live while funding and setup change the wallet.
  const payments = await preloadQuery(
    api.payments.current,
    {},
    { token: session.token },
  );

  return <AccountPanel preloaded={payments} userId={session.userId} />;
}
