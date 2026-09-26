import Image from "next/image";

import { accents, type CompanionSettings } from "@/lib/companion-art";
import { cn } from "@/lib/utils";

export function CompanionScene({
  name,
  accent,
  animate = false,
  sticky = false,
}: CompanionSettings & { animate?: boolean; sticky?: boolean }) {
  const selected = accents.find((option) => option.id === accent)!;

  if (animate && selected.video) {
    return (
      <div className="relative aspect-[1/1.04] w-full max-w-65 shrink-0 md:aspect-[1/1.12] md:max-w-118">
        <video
          src={selected.video}
          autoPlay
          loop
          muted
          playsInline
          className="size-full rounded-[48%_48%_38%_38%] object-cover"
          aria-label={`${name || "Your companion"} waving hello`}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex aspect-[1/1.04] w-full max-w-65 shrink-0 flex-col items-center justify-center rounded-[48%_48%_38%_38%] transition-colors duration-300 motion-reduce:transition-none md:aspect-[1/1.12] md:max-w-118",
        selected.surface,
        sticky && "sticky top-2 z-10 max-md:max-w-58 md:static",
      )}
    >
      <div className="relative aspect-square w-[90%] md:w-full">
        {accents.map((option) => (
          <Image
            key={option.id}
            src={option.image}
            alt={
              option.id === accent
                ? `${name || "Your companion"}, the Naru bird`
                : ""
            }
            width={1254}
            height={1254}
            loading="eager"
            sizes="(max-width: 768px) 260px, 420px"
            className={cn(
              "absolute inset-0 size-full object-contain p-[9%] transition-opacity duration-300 motion-reduce:transition-none",
              option.id === accent ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
      </div>
      <div className="flex max-w-full items-center gap-2 px-5 pb-4 text-xs font-medium wrap-anywhere md:pb-7">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", selected.swatch)}
        />
        <span>{name.trim() || "Your companion"}</span>
      </div>
    </div>
  );
}
