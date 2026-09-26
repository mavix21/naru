"use client";

import { SignIn, SignUp } from "@clerk/nextjs";

const appearance = {
  elements: {
    rootBox: "w-full max-w-100",
    cardBox: "w-full border border-border shadow-sm",
    card: "bg-card",
  },
};

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <div className="flex justify-center">
      {mode === "sign-in" ? (
        <SignIn
          appearance={appearance}
          routing="path"
          path="/sign-in"
          forceRedirectUrl="/home"
          signUpForceRedirectUrl="/home"
        />
      ) : (
        <SignUp
          appearance={appearance}
          routing="path"
          path="/sign-up"
          forceRedirectUrl="/home"
          signInForceRedirectUrl="/home"
        />
      )}
    </div>
  );
}
