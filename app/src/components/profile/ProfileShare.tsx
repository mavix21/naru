"use client";

import { IconCheck, IconCopy, IconShare } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { copyProfileLink, shareProfileLink } from "@/lib/profile-sharing";

export function ProfileShare({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function share(copy: boolean) {
    setBusy(true);
    setNotice("");

    try {
      const result = await (copy
        ? copyProfileLink(url)
        : shareProfileLink(url));

      if (result === "copied") setNotice("Link copied.");

      if (result === "shared") setNotice("Profile shared.");
    } catch {
      setNotice("Select and copy the link below to share it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void share(false)} disabled={busy}>
          <IconShare />
          Share profile
        </Button>
        <Button
          variant="outline"
          onClick={() => void share(true)}
          disabled={busy}
        >
          {notice === "Link copied." ? <IconCheck /> : <IconCopy />}Copy link
        </Button>
      </div>
      <output className="block text-xs text-muted-foreground">{notice}</output>
      <details className="rounded-2xl border border-border/70 bg-background/70">
        <summary className="cursor-pointer rounded-2xl px-4 py-3 text-xs font-medium outline-ring">
          Profile QR & link
        </summary>
        <div className="flex flex-col items-center gap-4 px-4 pb-5">
          {children}
          <label className="w-full text-xs text-muted-foreground">
            Public profile link
            <input
              aria-label="Public profile link"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
              className="mt-2 w-full min-w-0 rounded-lg border bg-background p-2 text-base text-foreground outline-ring"
            />
          </label>
          <p className="text-center text-xs text-muted-foreground">
            Scan to meet this Naru. No sign-in needed.
          </p>
        </div>
      </details>
    </div>
  );
}
