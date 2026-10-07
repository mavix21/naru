import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SetupNotice } from "@/components/auth/SetupNotice";
import { LoadingStatus } from "@/components/LoadingStatus";
import { HomeLoading } from "@/components/messaging/HomeLoading";
import { getAuthConfig } from "@/lib/auth/config";

import { CustomizeLoading } from "./CustomizeLoading";
import { Frame } from "./Frame";
import { ActivationLoading } from "./Home";
import { Customize } from "./PublicExperience";
import { SessionExperience, type Screen } from "./SessionExperience";
import { Welcome } from "./Welcome";

export function ExperiencePage({ screen }: { screen: Screen | "welcome" }) {
  const configured = getAuthConfig();

  if (screen === "welcome")
    return configured ? (
      <Suspense fallback={<Welcome />}>
        <WelcomeSession />
      </Suspense>
    ) : (
      <Welcome />
    );

  if (configured)
    return (
      <SessionExperience
        screen={screen}
        loading={
          screen === "home" ? (
            <HomeLoading />
          ) : screen === "activate" ? (
            <>
              <ActivationLoading />
              <LoadingStatus />
            </>
          ) : (
            <CustomizeLoading />
          )
        }
      />
    );

  if (screen === "create") return <Customize />;

  return (
    <Frame back="/">
      <div className="flex flex-1 items-center justify-center">
        <SetupNotice />
      </div>
    </Frame>
  );
}

async function WelcomeSession() {
  const { userId } = await auth();

  if (userId) redirect("/home");

  return <Welcome />;
}
