import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Frame } from "@/components/onboarding/Frame";
import { IdentitySync } from "@/components/profile/IdentitySync";
import { UsernameCompletion } from "@/components/profile/UsernameCompletion";

export default function Page() {
  return (
    <Suspense
      fallback={
        <Frame back="/home">
          <output className="py-16">Loading your profile…</output>
        </Frame>
      }
    >
      <Completion />
    </Suspense>
  );
}

async function Completion() {
  const { userId } = await auth();

  if (!userId) redirect("/sign-in");

  return (
    <Frame back="/home">
      <IdentitySync key={userId} />
      <section className="mx-auto w-full max-w-110 flex-1 py-10 md:py-18">
        <UsernameCompletion />
      </section>
    </Frame>
  );
}
