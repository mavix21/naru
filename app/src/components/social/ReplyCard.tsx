"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { Person } from "./Person";
import { socialCardClass } from "./SplitCard";

export function ReplyCard({ id }: { id: Id<"replies"> }) {
  const data = useQuery(api.replies.get, { id });
  const confirm = useMutation(api.replies.confirm);
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!data)
    return (
      <output className="text-xs text-muted-foreground">Loading reply…</output>
    );
  const { reply, other, title } = data;

  async function send(cancel = false) {
    if (busy || !data) return;
    setBusy(true);
    setError(undefined);

    try {
      await confirm({ id, text: text ?? data.reply.text, cancel });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t send your reply.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={socialCardClass} aria-label="Reply preview">
      <p className="mb-4 text-[10px] tracking-wider text-muted-foreground uppercase">
        {reply.state === "draft"
          ? "Preview your reply"
          : reply.state === "sent"
            ? "Reply delivered"
            : "Reply cancelled"}
      </p>
      <Person person={other} />
      <p className="mt-3 text-xs text-muted-foreground">About {title}</p>
      {reply.state === "draft" ? (
        <>
          <label className="mt-4 block text-xs">
            Your message
            <textarea
              rows={3}
              maxLength={500}
              value={text ?? reply.text}
              onChange={(e) => setText(e.target.value)}
              className="mt-2 w-full resize-none rounded-2xl border bg-background p-3 text-sm outline-ring"
            />
          </label>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            Only this message is shared. It does not schedule or guarantee a
            payment.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy || !(text ?? reply.text).trim()}
              onClick={() => void send()}
            >
              Confirm & send
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void send(true)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <blockquote className="mt-4 border-l-2 pl-3 text-sm whitespace-pre-wrap">
          {reply.text}
        </blockquote>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
