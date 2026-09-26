import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ClerkProvider } from "@clerk/nextjs";
import { Geist } from "next/font/google";
import { Suspense } from "react";

import "./globals.css";

import { getAuthConfig } from "@/lib/auth/config";
import { cn } from "@/lib/utils";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

import { Toaster } from "../components/ui/sonner";
import Providers from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Naru",
  description: "A personal money assistant for everyday life.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = getAuthConfig();

  const content = (
    <Providers>
      <main className="min-h-dvh">{children}</main>
      <Toaster />
    </Providers>
  );

  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        {config ? (
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center">
                <span className="text-[33px] leading-none font-semibold tracking-[-2px]">
                  naru
                  <span className="text-ring" aria-hidden="true">
                    .
                  </span>
                </span>
              </div>
            }
          >
            <ClerkProvider
              dynamic
              publishableKey={config.publishableKey}
              signInUrl="/sign-in"
              signUpUrl="/sign-up"
              signInFallbackRedirectUrl="/home"
              signUpFallbackRedirectUrl="/home"
              appearance={{
                variables: {
                  colorPrimary: "#344c43",
                  borderRadius: "1rem",
                  fontFamily: "var(--font-geist), sans-serif",
                },
              }}
            >
              <ConvexClientProvider url={config.convexUrl}>
                {content}
              </ConvexClientProvider>
            </ClerkProvider>
          </Suspense>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
