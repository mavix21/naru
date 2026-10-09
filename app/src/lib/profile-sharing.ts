export async function copyProfileLink(url: string) {
  await navigator.clipboard.writeText(url);

  return "copied" as const;
}

export async function shareProfileLink(url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "A little corner of Naru", url });

      return "shared" as const;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        return "cancelled" as const;
    }
  }

  return copyProfileLink(url);
}
