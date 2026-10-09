import type { NextRequest } from "next/server";

import { verifyWebhook } from "@clerk/nextjs/webhooks";

import { ProfileConflict, synchronizeProfile } from "@/lib/profile-server";

export async function POST(request: NextRequest) {
  let event;

  try {
    event = await verifyWebhook(request);
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  if (event.type !== "user.created" && event.type !== "user.updated")
    return new Response(null, { status: 204 });

  try {
    // Fetch current Clerk state rather than trusting event order or an old name.
    await synchronizeProfile(event.data.id);
  } catch (error) {
    // Conflicting handles need user correction, not infinite webhook retries.
    if (!(error instanceof ProfileConflict))
      return new Response("Profile synchronization pending", { status: 503 });
  }

  return new Response(null, { status: 204 });
}
