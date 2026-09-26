"use client";

import type { Id } from "@naru/backend/data-model";

import { api } from "@naru/backend/api";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { Person, type PersonIdentity } from "./Person";
import { UsernameForm } from "./UsernameForm";

export function People({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.social.current>;
}) {
  const data = usePreloadedQuery(preloaded);
  const search = useMutation(api.social.findUsername);
  const act = useMutation(api.social.friendAction);
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<PersonIdentity | null>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function action(
    personId: Id<"profiles">,
    action: "send" | "accept" | "decline" | "cancel" | "remove",
  ) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      await act({ personId, action });
      setNotice(
        action === "send"
          ? "Friend request sent."
          : action === "accept"
            ? "You’re friends now."
            : "Updated.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!data.me || editing)
    return (
      <UsernameForm
        initial={data.me ?? undefined}
        onSaved={() => setEditing(false)}
      />
    );

  const related = [...data.friends, ...data.incoming, ...data.outgoing].find(
    (r) => r.person.userId === found?.userId,
  );

  return (
    <section id="people" aria-label="People" className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Your people.</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You’re @{data.me.username}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
          Edit profile
        </Button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          setNotice(undefined);

          try {
            setFound(await search({ username }));
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Search unavailable.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="people-search" className="text-xs">
          Find a friend by exact username
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="people-search"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFound(undefined);
            }}
            placeholder="@username"
            maxLength={25}
            autoCapitalize="none"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-ring"
          />
          <Button type="submit" size="sm" disabled={busy || !username.trim()}>
            Find
          </Button>
        </div>
      </form>
      {found === null && (
        <p className="text-xs text-muted-foreground">
          No one found with that username.
        </p>
      )}
      {found && (
        <div className="space-y-3 rounded-2xl border p-3">
          <Person person={found} />
          {found.userId !== data.me.userId &&
            (related ? (
              <p className="text-xs text-muted-foreground">
                {related.state === "accepted"
                  ? "Already friends"
                  : related.incoming
                    ? "Their invitation is below"
                    : "Request pending"}
              </p>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void action(found.userId, "send")}
              >
                Add friend
              </Button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="block text-xs text-muted-foreground">
          {notice}
        </output>
      )}
      {(
        [
          ["Invitations", data.incoming],
          ["Sent requests", data.outgoing],
          ["Friends", data.friends],
        ] as const
      ).map(([title, rows]) => (
        <div key={title}>
          <h3 className="mb-3 text-[10px] tracking-wider text-muted-foreground uppercase">
            {title} · {rows.length}
          </h3>
          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.id} className="space-y-2">
                <Person person={row.person} />
                <div className="flex gap-1 pl-13">
                  {title === "Invitations" ? (
                    <>
                      <Button
                        size="xs"
                        disabled={busy}
                        onClick={() => void action(row.person.userId, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          void action(row.person.userId, "decline")
                        }
                      >
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          row.person.userId,
                          title === "Friends" ? "remove" : "cancel",
                        )
                      }
                    >
                      {title === "Friends" ? "Remove friend" : "Cancel request"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!data.friends.length && (
        <p className="text-xs leading-6 text-muted-foreground">
          Once you’re friends, type @ in your conversation to split an expense
          together.
        </p>
      )}
    </section>
  );
}
