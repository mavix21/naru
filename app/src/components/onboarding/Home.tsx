"use client";

import type { Doc } from "@naru/backend/data-model";
import type { ReactNode } from "react";

import { UserButton } from "@clerk/nextjs";
import { api } from "@naru/backend/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { validName, type CompanionSettings } from "@/lib/companion";

import { CompanionFields } from "./CompanionFields";
import { CompanionScene } from "./CompanionScene";
import {
  Description,
  Eyebrow,
  Frame,
  Heading,
  Notice,
  Scene,
  SceneCopy,
} from "./Frame";
import { ActivationPaymentsLoading, Payments } from "./Payments";

export function Home({
  companion,
  userId,
}: {
  companion: Doc<"companions">;
  userId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<CompanionSettings>(companion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = useMutation(api.companions.update);
  const visible = editing ? settings : companion;

  return (
    <Frame controls={<UserButton />}>
      <Scene className="max-md:gap-2">
        <CompanionScene
          name={visible.name}
          accent={visible.accent}
          sticky={editing}
        />
        <SceneCopy>
          {editing ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();

                if (!validName(settings.name) || busy) return;
                setBusy(true);
                setError(undefined);

                try {
                  await update({
                    name: settings.name,
                    accent: settings.accent,
                  });
                  setEditing(false);
                } catch {
                  setError("Your changes couldn’t be saved. Please try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Eyebrow>A little change</Eyebrow>
              <Heading>Make it yours.</Heading>
              <CompanionFields
                value={settings}
                onChange={setSettings}
                disabled={busy}
              />
              {error && <Notice>{error}</Notice>}
              <div className="flex items-center gap-4">
                <Button
                  size="lg"
                  type="submit"
                  disabled={busy || !validName(settings.name)}
                >
                  {busy ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <Eyebrow>Your everyday companion</Eyebrow>
              <Heading>Hello, you.</Heading>
              <Description>
                <span className="wrap-anywhere">{companion.name}</span> is right
                here with you.
              </Description>
              <div className="mb-6">
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setSettings(companion);
                    setError(undefined);
                    setEditing(true);
                  }}
                >
                  Edit companion <span aria-hidden="true">↗</span>
                </Button>
              </div>
              <Payments userId={userId} />
            </>
          )}
        </SceneCopy>
      </Scene>
    </Frame>
  );
}

function ActivationLayout({
  companion,
  account = true,
  children,
}: {
  companion?: Doc<"companions">;
  account?: boolean;
  children: ReactNode;
}) {
  return (
    <Frame controls={account ? <UserButton /> : undefined}>
      <Scene className="md:content-center">
        {companion ? (
          <CompanionScene name={companion.name} accent={companion.accent} />
        ) : (
          <div
            aria-hidden="true"
            className="aspect-[1/1.04] w-full max-w-65 shrink-0 rounded-[48%_48%_38%_38%] bg-muted md:aspect-[1/1.12] md:max-w-118"
          />
        )}
        <SceneCopy className="motion-safe:animate-none">
          <Eyebrow>Companion saved</Eyebrow>
          <Heading>Ready when you are.</Heading>
          <Description>Add a passkey for payments, or do it later.</Description>
          {children}
        </SceneCopy>
      </Scene>
    </Frame>
  );
}

export function ActivationLoading({
  account = false,
  slow = false,
}: {
  account?: boolean;
  slow?: boolean;
}) {
  return (
    <ActivationLayout account={account}>
      <ActivationPaymentsLoading slow={slow} />
    </ActivationLayout>
  );
}

export function Activate({
  companion,
  userId,
}: {
  companion: Doc<"companions">;
  userId: string;
}) {
  const finish = useMutation(api.companions.finishPaymentPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();

  async function goHome() {
    setBusy(true);

    try {
      await finish({});
      router.replace("/home");
    } catch {
      setError("Couldn’t save your choice. Please try again.");
      setBusy(false);
    }
  }

  return (
    <ActivationLayout companion={companion}>
      <Payments
        userId={userId}
        leaving={busy}
        onContinue={() => {
          if (!busy) void goHome();
        }}
        leaveError={error}
      />
    </ActivationLayout>
  );
}
