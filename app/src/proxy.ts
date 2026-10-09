import { clerkMiddleware } from "@clerk/nextjs/server";
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
    // Normalize the URL here; the profile route owns data and not-found UI.
    if (/^@[a-z][a-z0-9_]{2,23}$/i.test(handle)) {
      const pathname = profilePath(handle.slice(1));

      if (request.nextUrl.pathname !== pathname) {
        const url = request.nextUrl.clone();
        url.pathname = pathname;

        return NextResponse.redirect(url, 308);
      }
    }

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
    "/account/:path*",
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
