"use client";

import { SignIn, SignUp } from "@clerk/nextjs";

// Keep the managed forms reusable when the product adds onboarding later.
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <div className="flex justify-center">
      {mode === "sign-in" ? (
        <SignIn routing="path" path="/sign-in" />
      ) : (
        <SignUp routing="path" path="/sign-up" />
      )}
    </div>
  );
}
