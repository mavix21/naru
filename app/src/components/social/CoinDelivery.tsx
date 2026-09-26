"use client";

import { IconCoin } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { PersonAvatar, type PersonIdentity } from "./Person";

export function CoinDelivery({
  receipt,
  from,
  to,
}: {
  receipt: string;
  from: PersonIdentity;
  to: PersonIdentity;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const key = `naru:receipt-delight:${receipt}`;

    const frame = requestAnimationFrame(() => {
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "seen");
      } catch {
        /* Confirmation is still visible when browser storage is blocked. */
      }

      setVisible(true);
    });

    const timer = setTimeout(() => setVisible(false), 2200);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [receipt]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="mt-4 flex items-center justify-center gap-4 rounded-2xl bg-muted/30 p-3"
    >
      <PersonAvatar person={from} />
      <span className="relative h-8 w-16">
        <IconCoin className="naru-coin-delivery absolute top-1 size-6 text-companion-sunshine" />
      </span>
      <PersonAvatar person={to} />
    </div>
  );
}
