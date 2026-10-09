import { ConvexError } from "convex/values";

export const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;

const reserved = new Set([
  "admin",
  "administrator",
  "api",
  "billing",
  "clerk",
  "create",
  "help",
  "home",
  "login",
  "logout",
  "naru",
  "narus",
  "official",
  "payments",
  "profile",
  "root",
  "security",
  "settings",
  "signup",
  "staff",
  "support",
  "system",
  "username",
  "wallet",
  "www",
]);

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function cleanUsername(value: string) {
  const username = normalizeUsername(value);

  if (!usernamePattern.test(username))
    throw new ConvexError(
      "Use 3–24 letters, numbers or underscores, starting with a letter.",
    );

  if (reserved.has(username))
    throw new ConvexError("That username is reserved. Choose another.");

  return username;
}

export function cleanDisplayName(value: string) {
  const name = value.trim();

  if (!name || name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new ConvexError("Use a display name of 1–60 characters.");

  return name;
}

export function cleanBio(value: string) {
  const bio = value.trim();

  if (bio.length > 160 || /[\p{Cc}\p{Cf}]/u.test(bio))
    throw new ConvexError(
      "Use a short bio of up to 160 characters, on one line.",
    );

  return bio;
}
