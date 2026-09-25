"use client";

import { Button } from "@/components/ui/button";

export default function AuthError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4">
      <p role="alert">
        Authentication or profile loading failed. Check the Clerk/Convex setup
        and your connection, then try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
