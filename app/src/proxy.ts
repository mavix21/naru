import { clerkMiddleware } from "@clerk/nextjs/server";
import { api } from "@naru/backend/api";
import { fetchQuery } from "convex/nextjs";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { profilePath } from "@/lib/profile";

const clerk = clerkMiddleware({ signInUrl: "/sign-in", signUpUrl: "/sign-up" });

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  let handle: string;

  try {
    handle = decodeURIComponent(request.nextUrl.pathname.slice(1));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  if (handle.startsWith("@")) {
    // Resolve before Next starts streaming so unknown usernames have a real
    // HTTP 404 (a notFound() inside Suspense alone would stream a 200).
    const profile = await fetchQuery(api.profiles.publicByUsername, {
      username: handle.slice(1),
    });

    if (!profile) {
      const response = NextResponse.rewrite(
        new URL("/profile-not-found", request.url),
        { status: 404 },
      );

      response.headers.set("Cache-Control", "no-store");

      return response;
    }

    if (request.nextUrl.pathname !== profilePath(profile.username))
      return NextResponse.redirect(
        new URL(profilePath(profile.username), request.url),
        308,
      );
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");

    return response;
  }

  const response = getAuthConfig()
    ? (await clerk(request, event)) || NextResponse.next()
    : NextResponse.next();

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  return response;
}

export const config = {
  matcher: [
    "/",
    "/create",
    "/home",
    "/activate",
    "/username",
    "/:handle",
    "/api/payments",
    "/api/chat",
    "/api/transfers",
    "/api/swaps",
    "/api/splits",
    "/api/split-payments",
    "/sign-in/:path*",
    "/sign-up/:path*",
  ],
};
