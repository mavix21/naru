import { accents, type Accent } from "@/lib/companion-art";
import { cn } from "@/lib/utils";

export function ProfileAvatar({
  name,
  accent = "sky",
  className,
}: {
  name: string;
  accent?: Accent;
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();

  const selected = accents.find((option) => option.id === accent)!;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-medium text-foreground dark:text-background",
        selected.surface,
        className,
      )}
    >
      {initials}
    </span>
  );
}
