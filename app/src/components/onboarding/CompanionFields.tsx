"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { accents, type CompanionSettings } from "@/lib/companion";
import { cn } from "@/lib/utils";

export function CompanionFields({
  value,
  onChange,
  disabled,
}: {
  value: CompanionSettings;
  onChange: (settings: CompanionSettings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="my-6 flex flex-col gap-6 md:my-8">
      <div className="flex flex-col gap-2">
        <Label htmlFor="companion-name">Companion name</Label>
        <Input
          id="companion-name"
          size="lg"
          autoComplete="off"
          maxLength={32}
          required
          value={value.name}
          disabled={disabled}
          placeholder="Naru"
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>
      <div className="flex flex-col">
        <p id="companion-colors" className="text-sm font-medium">
          A color that feels like you
        </p>
        <RadioGroup
          value={value.accent}
          disabled={disabled}
          aria-labelledby="companion-colors"
          className="mt-5"
          onValueChange={(selected) => {
            const accent = accents.find((option) => option.id === selected);

            if (accent) onChange({ ...value, accent: accent.id });
          }}
        >
          <div className="flex gap-6">
            {accents.map((accent) => (
              <div key={accent.id} className="flex flex-col items-center gap-3">
                <div className="relative size-11">
                  <span
                    className={cn(
                      "absolute inset-0 rounded-full",
                      accent.swatch,
                    )}
                    aria-hidden="true"
                  />
                  <RadioGroupItem
                    id={`accent-${accent.id}`}
                    value={accent.id}
                    variant="swatch"
                    aria-label={accent.label}
                    className="absolute inset-0"
                  />
                </div>
                <Label htmlFor={`accent-${accent.id}`}>{accent.label}</Label>
              </div>
            ))}
          </div>
        </RadioGroup>
      </div>
    </div>
  );
}
