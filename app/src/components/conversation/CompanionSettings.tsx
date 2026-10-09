"use client";

import { api } from "@naru/backend/api";
import { useMutation } from "convex/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CompanionFields } from "@/components/onboarding/CompanionFields";
import { Button } from "@/components/ui/button";
import { validName, type CompanionSettings as Settings } from "@/lib/companion";
import { accents } from "@/lib/companion-art";
import { cn } from "@/lib/utils";

export function CompanionSettings({ companion }: { companion: Settings }) {
  const [settings, setSettings] = useState(companion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = useMutation(api.companions.update);
  const router = useRouter();
  const selected = accents.find((option) => option.id === settings.accent)!;

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
      <div
        className={cn(
          "relative mx-auto mt-5 size-40 rounded-[48%_48%_38%_38%] transition-colors duration-300 motion-reduce:transition-none",
          selected.surface,
        )}
      >
        {accents.map((option) => (
          <Image
            key={option.id}
            src={option.image}
            alt={
              option.id === settings.accent
                ? `${settings.name.trim() || "Your companion"}, the ${option.label.toLowerCase()} Naru bird`
                : ""
            }
            width={1254}
            height={1254}
            loading="eager"
            sizes="160px"
            className={cn(
              "absolute inset-0 size-full object-contain p-[9%] transition-opacity duration-300 motion-reduce:transition-none",
              option.id === settings.accent ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
      </div>
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
