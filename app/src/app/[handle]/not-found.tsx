import Link from "next/link";

import { Frame } from "@/components/onboarding/Frame";

export default function NotFound() {
  return (
    <Frame>
      <div className="my-auto space-y-4 py-20 text-center">
        <p className="text-xs text-muted-foreground">404 · Profile not found</p>
        <h1 className="text-3xl tracking-tight">No Naru here just yet.</h1>
        <p className="text-sm text-muted-foreground">
          Check the username and try again.
        </p>
        <Link
          href="/"
          className="inline-block text-sm font-medium underline underline-offset-4"
        >
          Back to Naru
        </Link>
      </div>
    </Frame>
  );
}
