"use client";

import { api } from "@naru/backend/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CompanionFields } from "@/components/onboarding/CompanionFields";
import { Button } from "@/components/ui/button";
import { validName, type CompanionSettings as Settings } from "@/lib/companion";

export function CompanionSettings({ companion }: { companion: Settings }) {
  const [settings, setSettings] = useState(companion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = useMutation(api.companions.update);
  const router = useRouter();

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();

        if (busy || !validName(settings.name)) return;
        setBusy(true);
        setError(undefined);

        try {
          await update(settings);
          router.refresh();
        } catch {
          setError("Your changes couldn’t be saved. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <CompanionFields
        value={settings}
        onChange={setSettings}
        disabled={busy}
      />
      {error && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !validName(settings.name)}>
        {busy ? "Saving…" : "Save companion"}
      </Button>
    </form>
  );
}
