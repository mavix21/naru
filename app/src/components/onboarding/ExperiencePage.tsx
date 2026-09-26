import { SetupNotice } from "@/components/auth/SetupNotice";
import { getAuthConfig } from "@/lib/auth/config";

import { Frame } from "./Frame";
import { Customize, Welcome } from "./PublicExperience";
import { SessionExperience, type Screen } from "./SessionExperience";

export function ExperiencePage({ screen }: { screen: Screen }) {
  if (getAuthConfig()) return <SessionExperience screen={screen} />;

  if (screen === "welcome") return <Welcome />;

  if (screen === "create") return <Customize />;

  return (
    <Frame back="/">
      <div className="flex flex-1 items-center justify-center">
        <SetupNotice />
      </div>
    </Frame>
  );
}
