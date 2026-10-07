"use client";

import type { ReactNode } from "react";

import { useAuth, UserButton } from "@clerk/nextjs";
import { api } from "@naru/backend/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { UsernameForm } from "@/components/social/UsernameForm";
import { Button } from "@/components/ui/button";
import {
  clearDraft,
  useCompanionDraft,
  useHydrated,
  validName,
} from "@/lib/companion";

import { CompanionScene } from "./CompanionScene";
import { Frame, Heading, Notice, Scene, SceneCopy } from "./Frame";
import { Activate, Home } from "./Home";
import { Customize } from "./PublicExperience";

export type Screen = "create" | "home" | "activate";

function Navigate({ to, loading }: { to: string; loading: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to);
  }, [router, to]);

  return loading;
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
  loading,
}: {
  screen: Screen;
  userId: string;
  loading: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  const companion = useQuery(
    api.companions.current,
    isAuthenticated ? {} : "skip",
  );

  const profile = useQuery(api.profiles.current, isAuthenticated ? {} : "skip");

  const draft = useCompanionDraft();
  const hydrated = useHydrated();

  useEffect(() => {
    if (companion) clearDraft();
  }, [companion]);

  if (
    isLoading ||
    !isAuthenticated ||
    companion === undefined ||
    profile === undefined ||
    !hydrated
  )
    return loading;

  if (!companion) {
    if (screen === "create") return <Customize signedIn />;

    if (draft.saveRequested && validName(draft.name)) return <SaveCompanion />;

    return <Navigate to="/create" loading={loading} />;
  }

  if (screen === "create") return <Navigate to="/home" loading={loading} />;

  if (!companion.paymentChoiceMade && !profile?.username)
    return (
      <Frame controls={<UserButton />}>
        <Scene>
          <CompanionScene name={companion.name} accent={companion.accent} />
          <SceneCopy>
            <UsernameForm />
          </SceneCopy>
        </Scene>
      </Frame>
    );

  if (screen === "activate")
    return <Activate companion={companion} userId={userId} />;

  if (!companion.paymentChoiceMade)
    return <Navigate to="/activate" loading={loading} />;

  return <Home companion={companion} userId={userId} />;
}

export function SessionExperience({
  screen,
  loading,
}: {
  screen: Screen;
  loading: ReactNode;
}) {
  const { isLoaded, userId } = useAuth();

  if (!isLoaded) return loading;

  if (userId)
    return (
      <AuthenticatedExperience
        key={userId}
        screen={screen}
        userId={userId}
        loading={loading}
      />
    );

  if (screen === "create") return <Customize />;

  return <Navigate to="/sign-in" loading={loading} />;
}
