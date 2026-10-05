"use client";

import type { ReactNode } from "react";

import { IconDots } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function MobileTools({
  account,
  activity,
  companion,
}: {
  account: ReactNode;
  activity: ReactNode;
  companion: ReactNode;
}) {
  const [tab, setTab] = useState<"Account" | "Activity" | "Companion">(
    "Account",
  );

  return (
    <div className="md:hidden">
      <Popover>
        <PopoverTrigger
          variant="homeMenu"
          aria-label="Account, activity, and companion settings"
        >
          <IconDots className="size-5" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          variant="homeMenu"
          aria-label="Your Naru settings"
          className="max-h-[75dvh] w-[calc(100vw-2rem)] overflow-y-auto"
        >
          <div className="mb-3 flex gap-1 border-b pb-3">
            {(["Account", "Activity", "Companion"] as const).map((label) => (
              <Button
                key={label}
                variant={tab === label ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={tab === label}
                onClick={() => setTab(label)}
              >
                {label}
              </Button>
            ))}
          </div>
          {tab === "Account"
            ? account
            : tab === "Activity"
              ? activity
              : companion}
        </PopoverContent>
      </Popover>
    </div>
  );
}
