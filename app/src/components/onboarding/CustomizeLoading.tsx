import { LoadingStatus } from "@/components/LoadingStatus";
import { Button } from "@/components/ui/button";
import { accents } from "@/lib/companion-art";

import {
  Description,
  Eyebrow,
  Frame,
  Heading,
  Scene,
  SceneCopy,
} from "./Frame";

export function CustomizeLoading() {
  return (
    <Frame back="/">
      <Scene>
        <div
          aria-hidden="true"
          className="aspect-[1/1.04] w-full max-w-58 shrink-0 rounded-[48%_48%_38%_38%] bg-muted md:aspect-[1/1.12] md:max-w-118"
        />
        <SceneCopy className="motion-safe:animate-none">
          <Eyebrow>01 · Make it yours</Eyebrow>
          <Heading>
            A name. A color.
            <br />A little you.
          </Heading>
          <Description>Say hello to your new companion.</Description>
          <div aria-hidden="true" className="my-6 flex flex-col gap-6 md:my-8">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Companion name</p>
              <div className="h-13 rounded-xl border border-input bg-muted/50 motion-safe:animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-medium">A color that feels like you</p>
              <div className="mt-5 flex gap-6">
                {accents.map((accent) => (
                  <div
                    key={accent.id}
                    className="flex flex-col items-center gap-3"
                  >
                    <span className={`size-11 rounded-full ${accent.swatch}`} />
                    <span className="text-sm font-medium">{accent.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button size="lg" disabled>
            Continue <span aria-hidden="true">→</span>
          </Button>
          <output className="sr-only">Restoring your companion…</output>
        </SceneCopy>
      </Scene>
      <LoadingStatus />
    </Frame>
  );
}
