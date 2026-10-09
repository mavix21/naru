import QRCode from "qrcode";

import { profileUrl } from "@/lib/profile";

import { ProfileShare } from "./ProfileShare";

export function canonicalProfileUrl(username: string) {
  const origin =
    process.env.NARU_PUBLIC_ORIGIN || process.env.NARU_SMART_ACCOUNT_ORIGIN;

  if (!origin && process.env.NODE_ENV === "production")
    throw new Error(
      "Set NARU_PUBLIC_ORIGIN to the canonical public app origin.",
    );

  return profileUrl(username, origin || "http://localhost:3000");
}

export function ProfileQR({ url }: { url: string }) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size = modules.size + 8;

  const path = Array.from(modules.data)
    .flatMap((dark, index) =>
      dark
        ? [
            `M${(index % modules.size) + 4} ${Math.floor(index / modules.size) + 4}h1v1h-1z`,
          ]
        : [],
    )
    .join("");

  return (
    <svg
      aria-label="QR code for this public profile"
      viewBox={`0 0 ${size} ${size}`}
      width="192"
      height="192"
      className="max-w-full rounded-lg text-black [shape-rendering:crispEdges]"
    >
      <title>QR code for this public profile</title>
      <rect
        width={size}
        height={size}
        fill="currentColor"
        className="text-white"
      />
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export function ProfileSharing({ username }: { username: string }) {
  const url = canonicalProfileUrl(username);

  return (
    <ProfileShare url={url}>
      <ProfileQR url={url} />
    </ProfileShare>
  );
}
