import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AccountFrame } from "@/components/profile/AccountFrame";
import {
  ProfileFormSkeleton,
  UsernameFormSkeleton,
} from "@/components/profile/AccountSkeletons";
import { ProfileDetailsHeading } from "@/components/profile/ProfileDetailsHeading";
import { UsernameCompletion } from "@/components/profile/UsernameCompletion";

export default function Page() {
  return (
    <AccountFrame section="username">
      <div className="rounded-3xl border bg-card p-6 md:p-8">
        <Suspense fallback={<UsernameFormSkeleton />}>
          <Completion />
        </Suspense>
      </div>
    </AccountFrame>
  );
}

async function Completion() {
  const { userId } = await auth();

  if (!userId) redirect("/sign-in");

  return (
    <UsernameCompletion
      profileHeading={<ProfileDetailsHeading />}
      profileLoading={<ProfileFormSkeleton />}
    />
  );
}
