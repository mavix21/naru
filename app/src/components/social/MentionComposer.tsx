"use client";

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Rich friend/avatar suggestions need an ARIA listbox; a native select cannot retain the chat textarea's caret and active descendant. */

import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { editMentions, type Mention } from "@/lib/mentions";

import { Person, type PersonIdentity } from "./Person";

export function MentionText({
  text,
  mentions,
}: {
  text: string;
  mentions: Mention[];
}) {
  const parts = mentions.flatMap((mention, index) => {
    const before = text.slice(
      index ? mentions[index - 1].end : 0,
      mention.start,
    );

    return [
      before,
      <span
        key={index}
        className="rounded-md bg-primary/10 text-foreground ring-1 ring-primary/10"
        title="Selected Naru friend"
      >
        {text.slice(mention.start, mention.end)}
      </span>,
    ];
  });

  return (
    <>
      {parts}
      {text.slice(mentions.at(-1)?.end ?? 0)}
    </>
  );
}

export function MentionComposer({
  composer,
  draft,
  mentions,
  updateDraft,
  friends,
  named,
  name,
  hydrated,
  busy,
  submit,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  mentions: Mention[];
  updateDraft: (text: string, mentions?: Mention[]) => void;
  friends: PersonIdentity[];
  named: boolean;
  name: string;
  hydrated: boolean;
  busy: boolean;
  submit: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const mirror = useRef<HTMLDivElement>(null);
  const match = draft.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
  const start = match ? cursor - match[1].length - 1 : -1;

  const open =
    !!match &&
    !dismissed &&
    !mentions.some((m) => start >= m.start && start < m.end);

  const query = match?.[1].toLowerCase() ?? "";

  const suggestions = friends
    .filter((p) =>
      `${p.username} ${p.displayName} ${p.companionName}`
        .toLowerCase()
        .includes(query),
    )
    .slice(0, 8);

  const active = Math.min(selected, Math.max(suggestions.length - 1, 0));

  useEffect(() => {
    if (open)
      document
        .getElementById(`mention-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function choose(person: PersonIdentity) {
    const label = `@${person.username}`;
    const text = `${draft.slice(0, start)}${label} ${draft.slice(cursor)}`;
    const moved = editMentions(draft, text, mentions);
    updateDraft(
      text,
      [
        ...moved,
        { userId: person.userId, start, end: start + label.length, label },
      ].sort((a, b) => a.start - b.start),
    );
    const next = start + label.length + 1;
    setCursor(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(next, next);
    });
  }

  return (
    <div className="relative">
      {open && (
        <div className="absolute right-0 bottom-full left-0 z-20 mb-3 max-h-72 overflow-y-auto rounded-3xl border bg-popover p-2 shadow-lg">
          <p className="px-3 py-2 text-[10px] tracking-wider text-muted-foreground uppercase">
            Your friends
          </p>
          <div
            id="mention-options"
            role="listbox"
            aria-label="Mention a friend"
          >
            {suggestions.map((person, index) => (
              <div
                key={person.userId}
                id={`mention-${index}`}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(person)}
                  className={`w-full rounded-2xl p-3 text-left ${index === active ? "bg-muted" : "hover:bg-muted/50"}`}
                >
                  <Person person={person} />
                </button>
              </div>
            ))}
          </div>
          {!suggestions.length && (
            <output className="px-3 pb-3 text-xs leading-6 text-muted-foreground">
              {!named
                ? "Choose your username in People to get started."
                : !friends.length
                  ? "Add friends in People. Only accepted friends appear here."
                  : "No matching friends."}
            </output>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-3 rounded-[1.6rem] border border-border bg-card p-3 pl-5 shadow-[0_4px_24px_-12px_rgb(0_0_0/.15)] focus-within:border-ring"
      >
        <label className="sr-only" htmlFor="naru-message">
          Message {name}. Type @ to mention a friend.
        </label>
        <div className="relative min-w-0 flex-1">
          <div
            ref={mirror}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words py-2 text-base leading-6 md:text-sm"
          >
            <MentionText text={draft} mentions={mentions} />
            {draft.endsWith("\n") ? "\n" : ""}
          </div>
          <textarea
            ref={composer}
            id="naru-message"
            rows={1}
            value={draft}
            maxLength={4000}
            disabled={!hydrated}
            aria-autocomplete="list"
            aria-controls={open ? "mention-options" : undefined}
            aria-activedescendant={
              open && suggestions.length ? `mention-${active}` : undefined
            }
            onScroll={(e) => {
              if (mirror.current)
                mirror.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onChange={(e) => {
              updateDraft(e.target.value);
              setCursor(e.target.selectionStart);
              setSelected(0);
              setDismissed(false);
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onBlur={() => setDismissed(true)}
            onFocus={() => setDismissed(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;

              if (open && event.key === "Escape") {
                event.preventDefault();
                setDismissed(true);

                return;
              }

              if (open && suggestions.length) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelected(
                    (active +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      suggestions.length) %
                      suggestions.length,
                  );

                  return;
                }

                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  choose(suggestions[active]);

                  return;
                }
              }

              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                window.matchMedia("(min-width: 768px)").matches
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={`Talk to ${name}…`}
            className="relative block max-h-36 min-h-10 w-full resize-none bg-transparent py-2 text-base leading-6 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/70 md:text-sm"
          />
        </div>
        <Button
          type="submit"
          size="icon"
          className="size-10 shrink-0"
          disabled={!draft.trim() || busy || !hydrated}
          aria-label="Send message"
        >
          <span aria-hidden="true" className="text-xl">
            ↑
          </span>
        </Button>
      </form>
    </div>
  );
}
