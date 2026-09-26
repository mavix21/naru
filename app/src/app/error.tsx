"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-medium tracking-tight">
        We couldn’t load your companion.
      </h1>
      <p className="text-sm text-muted-foreground">
        Your saved settings are safe. Please try again.
      </p>
      <div className="flex items-center gap-4">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button render={<Link href="/" />} nativeButton={false} variant="link">
          Back to Naru
        </Button>
      </div>
    </section>
  );
}
