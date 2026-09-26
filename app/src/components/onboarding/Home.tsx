"use client";

import type { Doc } from "@naru/backend/data-model";

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
import { Payments } from "./Payments";

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
    <Frame controls={<UserButton />}>
      <Scene>
        <CompanionScene name={companion.name} accent={companion.accent} />
        <SceneCopy>
          <Eyebrow>Companion saved</Eyebrow>
          <Heading>
            A safe little
            <br />
            place to start.
          </Heading>
          <Description>
            One optional step: set up payments with a passkey on your device.
          </Description>
          <Payments
            userId={userId}
            leaving={busy}
            onContinue={() => {
              if (!busy) void goHome();
            }}
          />
          {error && <Notice>{error}</Notice>}
        </SceneCopy>
      </Scene>
    </Frame>
  );
}
