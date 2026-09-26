export type Accent = "sky" | "coral" | "sunshine";

export type CompanionSettings = { name: string; accent: Accent };

type AccentOption = {
  id: Accent;
  label: string;
  swatch: string;
  surface: string;
  image: string;
  video?: string;
};

export const accents: readonly AccentOption[] = [
  {
    id: "sky",
    label: "Sky",
    swatch: "bg-companion-sky",
    surface: "bg-companion-sky-surface",
    image: "/naru.png",
    video: "/naru-idle.mp4",
  },
  {
    id: "coral",
    label: "Coral",
    swatch: "bg-companion-coral",
    surface: "bg-companion-coral-surface",
    image: "/naru-red.png",
    video: "/naru-rojo-idle.mp4",
  },
  {
    id: "sunshine",
    label: "Sunshine",
    swatch: "bg-companion-sunshine",
    surface: "bg-companion-sunshine-surface",
    image: "/naru-yellow.png",
  },
];
