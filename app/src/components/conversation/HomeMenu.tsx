"use client";

import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function HomeMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger variant="homeMenu">{label}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label={label}
        variant="homeMenu"
        className="max-h-[min(70dvh,680px)] w-[calc(100vw-2rem)] overflow-y-auto md:w-96"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
