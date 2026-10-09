import { afterEach, describe, expect, it, vi } from "vitest";

import {
  profilePath,
  profileUrl,
  suggestedDisplayName,
} from "../src/lib/profile";
import { copyProfileLink, shareProfileLink } from "../src/lib/profile-sharing";

afterEach(() => vi.unstubAllGlobals());

describe("public identity presentation", () => {
  const email = {
    primaryEmailAddressId: "email-id",
    emailAddresses: [
      { id: "email-id", emailAddress: "jane.doe+test123@private.example" },
    ],
  };
  it("prefills the Google/Clerk name and only suggests a readable local part when missing", () => {
    expect(
      suggestedDisplayName({ ...email, firstName: "Janet", lastName: "Smith" }),
    ).toBe("Janet Smith");
    expect(
      suggestedDisplayName({ ...email, firstName: null, lastName: null }),
    ).toBe("Jane Doe");
    expect(
      suggestedDisplayName({
        ...email,
        firstName: email.emailAddresses[0].emailAddress,
        lastName: null,
      }),
    ).toBe("Jane Doe");
    expect(
      suggestedDisplayName({
        firstName: null,
        lastName: null,
        primaryEmailAddressId: null,
        emailAddresses: [],
      }),
    ).toBe("Naru friend");
  });

  it("makes one normalized canonical HTTP URL independent of origin path/query", () => {
    expect(profilePath("  Jane_DOE  ")).toBe("/@jane_doe");
    expect(profileUrl("JANE_DOE", "https://naru.example/nested?x=1")).toBe(
      "https://naru.example/@jane_doe",
    );
    expect(() => profileUrl("jane_doe", "javascript:alert(1)")).toThrow();
  });
});

describe("profile sharing", () => {
  const url = "https://naru.example/@jane_doe";
  it("uses native sharing when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    expect(await shareProfileLink(url)).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url }));
    expect(writeText).not.toHaveBeenCalled();
  });
  it("copies the canonical URL for unsupported or failed native sharing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareProfileLink(url)).toBe("copied");
    expect(writeText).toHaveBeenLastCalledWith(url);
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new Error("blocked")),
      clipboard: { writeText },
    });
    expect(await shareProfileLink(url)).toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(2);
  });
  it("does not copy on a cancelled share and surfaces clipboard failures", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", {
      share: vi
        .fn()
        .mockRejectedValue(new DOMException("cancelled", "AbortError")),
      clipboard: { writeText },
    });
    expect(await shareProfileLink(url)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
    await expect(copyProfileLink(url)).rejects.toThrow("denied");
  });
});
