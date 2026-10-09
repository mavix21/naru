export function profilePath(username: string) {
  return `/@${encodeURIComponent(username.trim().toLowerCase())}`;
}

export function profileUrl(username: string, origin: string) {
  const url = new URL(origin);

  if (!/^https?:$/.test(url.protocol))
    throw new Error("Invalid public profile origin.");

  return new URL(profilePath(username), url.origin).href;
}

export function suggestedDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
}) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  if (name && !name.includes("@"))
    return name.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 60) || "Naru friend";

  const email = user.emailAddresses.find(
    (item) => item.id === user.primaryEmailAddressId,
  )?.emailAddress;

  const local = email?.split("@")[0]?.split("+")[0] ?? "";
  const words = local.replace(/[^\p{L}]+/gu, " ").trim();

  return (
    words
      .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
      .slice(0, 60) || "Naru friend"
  );
}
