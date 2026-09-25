import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

import { getAuthConfig } from "@/lib/auth/config";

const clerk = clerkMiddleware({ signInUrl: "/sign-in", signUpUrl: "/sign-up" });

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = getAuthConfig()
    ? (await clerk(request, event)) || NextResponse.next()
    : NextResponse.next();

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  return response;
}

export const config = {
  matcher: ["/sign-in/:path*", "/sign-up/:path*"],
};
