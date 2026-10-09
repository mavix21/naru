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
  compact = false,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger variant="homeMenu">{label}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label={label}
        variant={compact ? "accountMenu" : "homeMenu"}
        className={
          compact
            ? "w-72 max-w-[calc(100vw-2rem)]"
            : "max-h-[min(70dvh,680px)] w-[calc(100vw-2rem)] overflow-y-auto md:w-96"
        }
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
