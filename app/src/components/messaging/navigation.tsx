"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export function useSelectedChat() {
  const params = useSearchParams();

  return (
    params?.get("chat") ??
    (params?.has("event") || params?.has("request") || params?.has("split")
      ? "naru"
      : null)
  );
}

export function WorkspaceState() {
  const selected = useSelectedChat();

  useEffect(() => {
    const viewport = window.visualViewport;

    const resize = () =>
      document.documentElement.style.setProperty(
        "--naru-viewport",
        `${viewport?.height ?? window.innerHeight}px`,
      );

    resize();
    viewport?.addEventListener("resize", resize);

    return () => {
      viewport?.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--naru-viewport");
    };
  }, []);

  // Keep mobile deep links and keyboard sizing independent of the data reads.
  return <span hidden data-chat-selected={selected ? "" : undefined} />;
}

export function openChat(id: string | null) {
  window.history.pushState(
    null,
    "",
    id ? `/home?chat=${encodeURIComponent(id)}` : "/home",
  );
}

export function BackToChats() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-1 md:hidden"
      aria-label="Back to chats"
      onClick={() => openChat(null)}
    >
      <IconArrowLeft className="size-5" />
    </Button>
  );
}
