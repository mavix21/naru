"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { ProfileConflict, synchronizeProfile } from "@/lib/profile-server";

export async function syncProfile(
  username?: string,
): Promise<
  | { username: string | null; error?: never; retryable?: never }
  | { error: string; retryable: boolean; username?: never }
> {
  const { userId } = await auth();

  if (!userId) return { error: "Sign in to continue.", retryable: false };
  const input = z.string().max(100).optional().safeParse(username);

  if (!input.success)
    return { error: "Enter a valid username.", retryable: false };

  try {
    return await synchronizeProfile(userId, input.data);
  } catch (error) {
    return {
      error:
        error instanceof ProfileConflict
          ? error.message
          : "Your profile couldn’t sync just yet. Please retry; your chats and money are still available.",
      retryable: !(error instanceof ProfileConflict),
    };
  }
}
