import { NextResponse, type NextRequest } from "next/server";

import { gateResponse, gateStatus } from "@/lib/smart-account/gate";

export function proxy(request: NextRequest) {
  const status = gateStatus(request.headers);

  if (status !== 200) return gateResponse(status);
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  return response;
}

export const config = {
  matcher: ["/dev/smart-account/:path*", "/api/dev/smart-account/:path*"],
};
