"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  saveDraft,
  useCompanionDraft,
  validName,
  type CompanionSettings,
} from "@/lib/companion";

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

export function Welcome() {
  return (
    <Frame
      controls={
        <Button
          render={<Link href="/sign-in" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
        >
          Sign in
        </Button>
      }
    >
      <Scene>
        <CompanionScene name="Naru" accent="sky" animate />
        <SceneCopy className="max-md:pt-7 max-md:text-center">
          <Heading>
            A little friend.
            <br />A fresh start.
          </Heading>
          <div className="max-md:flex max-md:justify-center">
            <Description>
              Make everyday money feel a little more human. Start with a
              companion of your own.
            </Description>
          </div>
          <Button
            render={<Link href="/create" />}
            nativeButton={false}
            size="lg"
          >
            Create your Naru <span aria-hidden="true">↗</span>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Yours to name. Yours to make.
          </p>
        </SceneCopy>
      </Scene>
    </Frame>
  );
}

export function Customize({ signedIn = false }: { signedIn?: boolean }) {
  const draft = useCompanionDraft();
  const [step, setStep] = useState<"customize" | "save">("customize");
  const [error, setError] = useState<string>();
  const router = useRouter();

  function update(settings: CompanionSettings) {
    try {
      saveDraft({ ...settings, saveRequested: false });
      setError(undefined);
    } catch {
      setError("Allow browser storage to keep your companion through sign-in.");
    }
  }

  function continueToSave() {
    if (!validName(draft.name)) {
      setError("Choose a name between 1 and 32 characters.");

      return;
    }

    try {
      saveDraft({ ...draft, name: draft.name.trim(), saveRequested: true });
      setStep("save");
      setError(undefined);
    } catch {
      setError("Allow browser storage to keep your companion through sign-in.");
    }
  }

  return (
    <Frame
      back="/"
      controls={
        !signedIn && (
          <Button
            render={<Link href="/sign-in" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            Sign in
          </Button>
        )
      }
    >
      <Scene>
        <CompanionScene name={draft.name} accent={draft.accent} sticky />
        <SceneCopy>
          <Eyebrow>
            {step === "customize"
              ? "01 · Make it yours"
              : "02 · Keep your companion"}
          </Eyebrow>
          {step === "customize" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                continueToSave();
              }}
            >
              <Heading>
                A name. A color.
                <br />A little you.
              </Heading>
              <Description>Say hello to your new companion.</Description>
              <CompanionFields value={draft} onChange={update} />
              {error && <Notice>{error}</Notice>}
              <Button size="lg" type="submit" disabled={!validName(draft.name)}>
                Continue <span aria-hidden="true">→</span>
              </Button>
            </form>
          ) : (
            <>
              <Heading>Make it official.</Heading>
              <Description>
                Save {draft.name} with your Naru account.
              </Description>
              {signedIn ? (
                <Button size="lg" onClick={() => router.push("/home")}>
                  Save companion <span aria-hidden="true">→</span>
                </Button>
              ) : (
                <div className="flex flex-col items-start">
                  <Button
                    render={<Link href="/sign-up" />}
                    nativeButton={false}
                    size="lg"
                  >
                    Save my companion <span aria-hidden="true">→</span>
                  </Button>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Already have an account?{" "}
                    <Button
                      render={<Link href="/sign-in" />}
                      nativeButton={false}
                      variant="link"
                      size="sm"
                    >
                      Sign in
                    </Button>
                  </p>
                </div>
              )}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mt-4"
                onClick={() => setStep("customize")}
              >
                Keep customizing
              </Button>
            </>
          )}
        </SceneCopy>
      </Scene>
    </Frame>
  );
}
