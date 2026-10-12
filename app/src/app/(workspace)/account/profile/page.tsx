import { api } from "@naru/backend/api";
import { preloadQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AccountFrame } from "@/components/profile/AccountFrame";
import { ProfileFormSkeleton } from "@/components/profile/AccountSkeletons";
import { PreloadedProfileSettings } from "@/components/profile/ProfileSettings";
import { getAuthConfig } from "@/lib/auth/config";
import { sessionIdentity } from "@/lib/auth/server";

export default function Page() {
  return (
    <AccountFrame section="profile">
      <div className="max-w-xl rounded-3xl border bg-card p-6 md:p-8">
        <Suspense fallback={<ProfileFormSkeleton />}>
          <Editor />
        </Suspense>
      </div>
    </AccountFrame>
  );
}

async function Editor() {
  "use cache: private";

  // Reuse the personalized tab for five minutes. Saving refreshes the router
  // cache; the editor's Convex subscription keeps its data reactive.
  cacheLife({ stale: 300 });

  if (!getAuthConfig()) redirect("/home");
  const session = await sessionIdentity();

  if (!session) redirect("/sign-in");

  // The editor subscribes to changes; the route supplies its initial snapshot.
  const profile = await preloadQuery(
    api.profiles.current,
    {},
    { token: session.token },
  );

  return (
    <PreloadedProfileSettings
      key={session.userId}
      preloaded={profile}
      loading={<ProfileFormSkeleton />}
    />
  );
}
