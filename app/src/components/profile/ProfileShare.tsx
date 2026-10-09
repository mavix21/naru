"use client";

import { Dialog } from "@base-ui/react/dialog";
import { IconCheck, IconCopy, IconShare, IconX } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
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
    if (busy) return;
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
    <Dialog.Root onOpenChange={() => setNotice("")}>
      <Dialog.Trigger
        className={buttonVariants({
          variant: "outline",
          size: "lg",
          className: "gap-2",
        })}
      >
        <IconShare aria-hidden="true" className="size-4" />
        Share profile
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border bg-background p-6 shadow-xl outline-none">
          <Dialog.Close
            aria-label="Close sharing"
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className: "absolute top-4 right-4",
            })}
          >
            <IconX aria-hidden="true" className="size-4" />
          </Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-medium tracking-tight">
            Share this profile
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            Send the link, or let someone scan the QR code.
          </Dialog.Description>
          <div className="my-6 flex justify-center">
            <div className="rounded-2xl border bg-white p-2">{children}</div>
          </div>
          <label className="block text-xs font-medium">
            Profile link
            <input
              aria-label="Public profile link"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border bg-muted/30 px-3 py-2 text-sm font-normal outline-ring"
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => void share(true)}
              disabled={busy}
            >
              {notice === "Link copied." ? <IconCheck /> : <IconCopy />}Copy
              link
            </Button>
            <Button size="lg" onClick={() => void share(false)} disabled={busy}>
              <IconShare />
              Share
            </Button>
          </div>
          <output className="mt-3 block min-h-5 text-center text-xs text-muted-foreground">
            {notice}
          </output>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
