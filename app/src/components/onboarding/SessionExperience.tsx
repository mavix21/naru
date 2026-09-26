"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { api } from "@naru/backend/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  clearDraft,
  useCompanionDraft,
  useHydrated,
  validName,
} from "@/lib/companion";

import { CompanionScene } from "./CompanionScene";
import { Frame, Heading, Notice, Scene, SceneCopy } from "./Frame";
import { Activate, ActivationLoading, Home } from "./Home";
import { Customize, Welcome } from "./PublicExperience";

export type Screen = "welcome" | "create" | "home" | "activate";

function Navigate({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to);
  }, [router, to]);

  return (
    <Loading account={to === "/activate"} activation={to === "/activate"} />
  );
}

function Loading({
  account = false,
  activation = false,
}: {
  account?: boolean;
  activation?: boolean;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);

    return () => clearTimeout(timer);
  }, []);

  if (activation) return <ActivationLoading account={account} slow={slow} />;

  return (
    <Frame controls={account ? <UserButton /> : undefined}>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <output className="text-sm text-muted-foreground">
          {slow
            ? "Your connection is taking a little longer."
            : "Getting your companion ready…"}
        </output>
        {slow && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        )}
      </div>
    </Frame>
  );
}

function SaveCompanion() {
  const draft = useCompanionDraft();
  const save = useMutation(api.companions.save);
  const router = useRouter();
  const requested = useRef(false);
  const [failed, setFailed] = useState(false);

  const persist = useCallback(async () => {
    setFailed(false);

    try {
      await save({ name: draft.name, accent: draft.accent });
      router.replace("/activate");
    } catch {
      setFailed(true);
    }
  }, [draft.name, draft.accent, router, save]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    // Persist only after authentication and an explicit save intent. The
    // mutation itself is idempotent, including across tabs and redirects.
    void persist();
  }, [persist]);

  return (
    <Frame controls={<UserButton />}>
      <Scene>
        <CompanionScene name={draft.name} accent={draft.accent} />
        <SceneCopy live>
          <Heading>
            {failed ? "Let’s try that again." : "Saving your companion…"}
          </Heading>
          {failed && (
            <>
              <Notice>
                Your draft is safe in this browser. We couldn’t save it just
                yet.
              </Notice>
              <Button size="lg" type="button" onClick={() => void persist()}>
                Retry save
              </Button>
            </>
          )}
        </SceneCopy>
      </Scene>
    </Frame>
  );
}

function AuthenticatedExperience({
  screen,
  userId,
}: {
  screen: Screen;
  userId: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  const companion = useQuery(
    api.companions.current,
    isAuthenticated ? {} : "skip",
  );

  const draft = useCompanionDraft();
  const hydrated = useHydrated();

  useEffect(() => {
    if (companion) clearDraft();
  }, [companion]);

  if (isLoading || !isAuthenticated || companion === undefined || !hydrated)
    return <Loading account activation={screen === "activate"} />;

  if (screen === "welcome") return <Navigate to="/home" />;

  if (!companion) {
    if (screen === "create") return <Customize signedIn />;

    if (draft.saveRequested && validName(draft.name)) return <SaveCompanion />;

    return <Navigate to="/create" />;
  }

  if (screen === "create") return <Navigate to="/home" />;

  if (screen === "activate")
    return <Activate companion={companion} userId={userId} />;

  if (!companion.paymentChoiceMade) return <Navigate to="/activate" />;

  return <Home companion={companion} userId={userId} />;
}

export function SessionExperience({ screen }: { screen: Screen }) {
  const { isLoaded, userId } = useAuth();

  if (!isLoaded)
    return screen === "welcome" ? (
      <Welcome />
    ) : (
      <Loading activation={screen === "activate"} />
    );

  if (userId)
    return (
      <AuthenticatedExperience key={userId} screen={screen} userId={userId} />
    );

  if (screen === "welcome") return <Welcome />;

  if (screen === "create") return <Customize />;

  return <Navigate to="/sign-in" />;
}
