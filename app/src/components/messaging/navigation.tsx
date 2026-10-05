"use client";

import { IconArrowLeft } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

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
