import type { Metadata } from "next";
import type { ReactNode } from "react";

import { labPrefix } from "@stellar-scaffold/app-lib/env";
import { Geist } from "next/font/google";

import "./globals.css";
import Link from "next/link";

import { cn } from "@/lib/utils";

import ConnectAccount from "../components/ConnectAccount";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { Toaster } from "../components/ui/sonner";
import Providers from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Scaffold Stellar",
  description: "Build dApps on the Stellar network",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <header className="flex flex-wrap items-center gap-4 border-b px-6 py-4 lg:px-12">
              <Link className="font-semibold whitespace-nowrap" href="/">
                Scaffold
              </Link>
              <nav
                className="flex flex-1 flex-wrap gap-1"
                aria-label="Main navigation"
              >
                <Button variant="ghost" render={<Link href="/debug" />}>
                  Contract Explorer
                </Button>
                <Button
                  variant="ghost"
                  render={
                    <a
                      aria-label="Transaction Explorer"
                      href={labPrefix()}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Transaction Explorer
                </Button>
              </nav>
              <ConnectAccount />
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 lg:px-12">
              {children}
            </main>
            <Separator />
            <footer className="px-6 py-4 lg:px-12">
              <nav
                className="flex flex-wrap justify-end gap-4 text-sm text-muted-foreground"
                aria-label="Footer navigation"
              >
                <a
                  href="https://github.com/stellar-scaffold/cli"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
                <a
                  href="https://www.youtube.com/watch?v=0syGaIn3ULk&list=PLmr3tp_7-7Gjj6gn5-bBn-QTMyaWzwOU5"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tutorial
                </a>
                <a
                  href="https://scaffoldstellar.org"
                  target="_blank"
                  rel="noreferrer"
                >
                  View docs
                </a>
              </nav>
            </footer>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
