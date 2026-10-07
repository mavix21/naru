"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function LoadingStatus() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);

    return () => clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return (
    <div className="fixed right-4 bottom-4 left-4 z-50 flex items-center justify-between gap-3 rounded-2xl border bg-background p-4 shadow-sm md:left-auto">
      <output className="text-sm text-muted-foreground">
        Your connection is taking a little longer.
      </output>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => window.location.reload()}
      >
        Try again
      </Button>
    </div>
  );
}
