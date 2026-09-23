import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Geist } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";

import "./globals.css";

import { cn } from "@/lib/utils";

import { Toaster } from "../components/ui/sonner";
import Providers from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Pulso | Lima",
  description: "Explora Lima en Pulso.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={cn("font-sans", geist.variable)}>
      <body>
        <Providers>
          <main className="min-h-dvh">{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
