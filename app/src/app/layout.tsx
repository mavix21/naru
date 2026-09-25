import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Geist } from "next/font/google";

import "./globals.css";

import { cn } from "@/lib/utils";

import { Toaster } from "../components/ui/sonner";
import Providers from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Naru",
  description: "A personal money assistant for everyday life.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <Providers>
          <main className="min-h-dvh">{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
