import { z } from "zod";

type RequestBody = {
  action: "review" | "authorize" | "cancel" | "edit" | "fund" | "request";
  requestId?: string;
  id?: string;
  revision?: number;
  amount?: string;
  reviewId?: string;
  auth?: string;
};

export async function conversationRequest<T = void>(
  userId: string,
  path: string,
  body?: RequestBody,
): Promise<T> {
  const headers = new Headers({ "X-Naru-User": userId });

  if (body) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(
      error.success
        ? error.data.error
        : "Please check your connection and try again.",
    );
  }

  // SAFETY: callers specify the return type of our own authenticated routes; signing independently validates the review schema and exact invocation.
  return data as T;
}
