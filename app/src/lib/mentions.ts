import type { Doc, Id } from "@naru/backend/data-model";

import { z } from "zod";

export type Mention = NonNullable<Doc<"messages">["mentions"]>[number];

const profileId = z
  .string()
  .min(1)
  .max(100)
  .transform((value) => {
    // SAFETY: this is an untrusted transport ID; Convex v.id and accepted-friend
    // checks validate its table, existence and permissions before every use.
    return value as Id<"profiles">;
  });

export const mentionInput = z
  .object({
    userId: profileId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    label: z.string().regex(/^@[a-z0-9_]{3,24}$/),
  })
  .strict();

export const mentionMetadata = z.object({
  mentions: z.array(mentionInput).max(12),
});

export const messageDraft = mentionMetadata.extend({
  text: z.string().max(4000),
});

// An edit through a token removes its verified identity. Text inserted before it
// moves its range; an arbitrary typed @name never acquires an identity.
export function editMentions(
  before: string,
  after: string,
  mentions: Mention[],
) {
  let start = 0;

  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let oldEnd = before.length;
  let newEnd = after.length;

  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const delta = newEnd - oldEnd;

  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];

    if (mention.start >= oldEnd)
      return [
        { ...mention, start: mention.start + delta, end: mention.end + delta },
      ];

    return [];
  });
}
