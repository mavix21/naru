import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { synchronizeIdentity } from "../src/lib/profile-sync";

const getUser = vi.fn();
const updateUser = vi.fn();
const mutation = vi.fn();

function synchronizeProfile(userId: string, username?: string) {
  return synchronizeIdentity(
    {
      users: { getUser, updateUser },
      mutate: mutation,
      key: "server-test-key",
    },
    userId,
    username,
  );
}

const clerkUser = {
  username: "google_name",
  firstName: "Google",
  lastName: "Name",
  primaryEmailAddressId: "email",
  emailAddresses: [{ id: "email", emailAddress: "secret@private.example" }],
};
let committed: string | null;
let pending: string | null;
let name: string | null;
let failCommit: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  committed = null;
  pending = null;
  name = null;
  failCommit = false;
  getUser.mockResolvedValue({ ...clerkUser });
  updateUser.mockImplementation(async (_id, args) =>
    getUser.mockResolvedValue({ ...clerkUser, username: args.username }),
  );
  mutation.mockImplementation(async (reference, args) => {
    switch (getFunctionName(reference)) {
      case "profiles:seedIdentity":
        name ??= args.suggestedName;
        return { username: committed, pendingUsername: pending };
      case "profiles:prepareUsername":
        if (committed) return { username: committed, claimId: null };
        pending ??= args.username.trim().toLowerCase();
        return { username: pending, claimId: "claim-id" };
      case "profiles:finishUsername":
        if (failCommit) {
          failCommit = false;
          throw new Error("Convex unavailable");
        }
        committed = pending;
        pending = null;
        return;
      case "profiles:releaseUsername":
        pending = null;
        return;
      default:
        throw new Error("Unexpected mutation");
    }
  });
});

describe("Clerk and Naru synchronization", () => {
  it("imports a prebuilt Google/signup username without rewriting Clerk", async () => {
    expect(await synchronizeProfile("owner")).toEqual({
      username: "google_name",
    });
    expect(committed).toBe("google_name");
    expect(name).toBe("Google Name");
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("keeps a missing username unclaimed and completes an existing user's explicit choice", async () => {
    getUser.mockResolvedValue({
      ...clerkUser,
      username: null,
      firstName: null,
      lastName: null,
    });
    expect(await synchronizeProfile("owner")).toEqual({ username: null });
    expect(name).toBe("Secret");
    expect(await synchronizeProfile("owner", " New_Name ")).toEqual({
      username: "new_name",
    });
    expect(updateUser).toHaveBeenCalledWith("owner", { username: "new_name" });
    expect(committed).toBe("new_name");
  });
  it("retries a committed Clerk update after a Convex outage without choosing a different handle", async () => {
    getUser.mockResolvedValue({ ...clerkUser, username: null });
    failCommit = true;
    await expect(synchronizeProfile("owner", "chosen_name")).rejects.toThrow(
      "Convex unavailable",
    );
    expect(committed).toBeNull();
    expect(pending).toBe("chosen_name");
    expect(await synchronizeProfile("owner", "different_name")).toEqual({
      username: "chosen_name",
    });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });
  it("retains reservations when Clerk's result is uncertain and resumes on the next session", async () => {
    updateUser.mockRejectedValueOnce(new Error("network timeout"));
    await expect(synchronizeProfile("owner", "chosen_name")).rejects.toThrow(
      "network timeout",
    );
    expect(pending).toBe("chosen_name");
    expect(await synchronizeProfile("owner")).toEqual({
      username: "chosen_name",
    });
    expect(committed).toBe("chosen_name");
  });
  it("releases a definite Clerk collision so the user can choose again", async () => {
    updateUser.mockRejectedValueOnce(
      new ClerkAPIResponseError("Taken", {
        status: 422,
        data: [{ code: "form_identifier_exists", message: "Taken" }],
      }),
    );
    await expect(synchronizeProfile("owner", "taken_name")).rejects.toThrow(
      /taken/,
    );
    expect(pending).toBeNull();
    expect(committed).toBeNull();
    expect(await synchronizeProfile("owner", "available_name")).toEqual({
      username: "available_name",
    });
  });
  it("never overwrites an existing Naru handle or user-edited name on changed Clerk data", async () => {
    committed = "legacy_name";
    name = "My chosen name";
    expect(await synchronizeProfile("owner", "replacement")).toEqual({
      username: "legacy_name",
    });
    expect(name).toBe("My chosen name");
    expect(updateUser).toHaveBeenCalledWith("owner", {
      username: "legacy_name",
    });
  });
  it("does not touch Clerk when Convex rejects a reserved or colliding signup name", async () => {
    const fallback = mutation.getMockImplementation()!;
    mutation.mockImplementation((reference, args) => {
      if (getFunctionName(reference) === "profiles:prepareUsername")
        throw new ConvexError("That username is reserved.");
      return fallback(reference, args);
    });
    await expect(synchronizeProfile("owner")).rejects.toThrow(/reserved/);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
