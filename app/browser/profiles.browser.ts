import {
  chromium,
  type Browser,
  expect as browserExpect,
} from "@playwright/test";
import { convexTest } from "convex-test";
import jsQR from "jsqr";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { api } from "../../backend/convex/_generated/api";
import schema from "../../backend/convex/schema";

const modules = {
  "../../backend/convex/_generated/server.js": () =>
    import("../../backend/convex/_generated/server.js"),
  "../../backend/convex/profiles.ts": () =>
    import("../../backend/convex/profiles"),
  "../../backend/convex/companions.ts": () =>
    import("../../backend/convex/companions"),
};
const database = convexTest(schema, modules);
const owner = database.withIdentity({
  subject: "private-clerk-id",
  email: "private@example.com",
});
const port = 3198;
const origin = `http://localhost:${port}`;
const key = "browser-profiles-only-server-key-0123456789";
let backend: Server;
let next: ChildProcess;
let browser: Browser;
let logs = "";

beforeAll(async () => {
  // The real Convex handlers run in an isolated database, exposed through a
  // minimal test transport. No production data, Clerk settings, or app routes
  // are altered. The actual Next pages/proxy/client code serve the browser.
  process.env.NARU_PAYMENTS_KEY = key;
  await owner.mutation(api.profiles.ensure, {});
  await database.mutation(api.profiles.seedIdentity, {
    key,
    clerkUserId: "private-clerk-id",
    suggestedName: "Jamie Rivera",
  });
  const claim = await database.mutation(api.profiles.prepareUsername, {
    key,
    clerkUserId: "private-clerk-id",
    username: "jamie_rivera",
  });
  await database.mutation(api.profiles.finishUsername, {
    key,
    clerkUserId: "private-clerk-id",
    username: claim.username,
    claimId: claim.claimId!,
  });
  await owner.mutation(api.companions.save, { name: "Pip", accent: "coral" });
  await owner.mutation(api.profiles.updatePublic, {
    displayName: "Jamie Rivera",
    bio: "Making room for the little things.",
  });
  await owner.mutation(api.profiles.updatePreference, {
    preferredGreeting: "PRIVATE GREETING",
  });

  backend = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const call = z
        .object({
          path: z.literal("profiles:publicByUsername"),
          args: z.array(z.object({ username: z.string() })).length(1),
        })
        .parse(JSON.parse(body));
      const value = await database.query(
        api.profiles.publicByUsername,
        call.args[0],
      );
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ status: "success", value, logLines: [] }));
    } catch {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          status: "error",
          errorMessage: "Unexpected test query",
        }),
      );
    }
  }).listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  if (!address || typeof address === "string")
    throw new Error("Test transport unavailable");
  next = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${address.port}`,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
        CLERK_SECRET_KEY: "",
        NARU_PUBLIC_ORIGIN: origin,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  next.stdout?.on("data", (chunk) => {
    logs += chunk;
  });
  next.stderr?.on("data", (chunk) => {
    logs += chunk;
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Server starting. */
    }
    if (next.exitCode !== null || attempt === 119) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  if (logs.includes("Error")) console.error(logs);
  await browser?.close();
  next?.kill("SIGTERM");
  backend?.closeAllConnections();
  backend?.close();
});

describe("anonymous public profile in the real app", () => {
  it("returns real 404s and redirects mixed-case usernames to the canonical route", async () => {
    const missing = await fetch(`${origin}/@unknown_username`);
    expect(missing.status, logs).toBe(404);
    expect(await missing.text()).toContain("Profile not found");
    const uppercase = await fetch(`${origin}/@JAMIE_RIVERA`, {
      redirect: "manual",
    });
    expect(uppercase.status).toBe(308);
    expect(new URL(uppercase.headers.get("location")!, origin).href).toBe(
      `${origin}/@jamie_rivera`,
    );
    const encoded = await fetch(`${origin}/%40jamie_rivera`, {
      redirect: "manual",
    });
    expect(encoded.status).toBe(308);
    const forgedWebhook = await fetch(`${origin}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "user.updated",
        data: { id: "private-clerk-id", username: "intruder" },
      }),
    });
    expect(forgedWebhook.status).toBe(400);
    expect(
      await database.query(api.profiles.publicByUsername, {
        username: "intruder",
      }),
    ).toBeNull();
  });

  it("shows the customized companion anonymously, fits mobile/desktop, and copies the canonical profile link", async () => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      errors.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    await page.goto(`${origin}/@jamie_rivera`);
    await browserExpect(
      page.getByRole("heading", { name: "Jamie Rivera" }),
    ).toBeVisible();
    await browserExpect(
      page.getByText("Making room for the little things."),
    ).toBeVisible();
    await browserExpect(page.getByAltText("Pip, the Naru bird")).toBeVisible();
    await browserExpect(
      page.getByRole("button", { name: /pay|donate/i }),
    ).toHaveCount(0);
    expect(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
    ).toBe(`${origin}/@jamie_rivera`);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      if (process.env.NARU_PROFILE_SCREENSHOTS && [390, 1440].includes(width))
        await page.screenshot({
          path: `${process.env.NARU_PROFILE_SCREENSHOTS}/naru-profile-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
    }
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await browserExpect(
      page.getByText("Link copied.", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/@jamie_rivera`,
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        value: undefined,
        configurable: true,
      }),
    );
    await page
      .getByRole("button", { name: "Share profile", exact: true })
      .click();
    await browserExpect(
      page.getByText("Link copied.", { exact: true }),
    ).toBeVisible();
    const markup = await page.content();
    expect(markup).not.toMatch(
      /private@example.com|private-clerk-id|PRIVATE GREETING|clerkUserId|preferredGreeting|paymentChoiceMade/,
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  it("decodes the rendered QR to the canonical URL, with no payment payload", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/@jamie_rivera`);
    await page.getByText("Profile QR & link", { exact: true }).click();
    const pixels = await page
      .locator('svg[aria-label="QR code for this public profile"]')
      .evaluate(async (svg) => {
        const image = new Image();
        // Preserve actual computed colors as well as geometry when rasterizing.
        const clone = svg.cloneNode(true) as SVGElement;
        clone
          .querySelector("rect")!
          .setAttribute(
            "fill",
            getComputedStyle(svg.querySelector("rect")!).fill,
          );
        clone
          .querySelector("path")!
          .setAttribute(
            "fill",
            getComputedStyle(svg.querySelector("path")!).fill,
          );
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 384;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 384, 384);
        return Array.from(context.getImageData(0, 0, 384, 384).data);
      });
    expect(jsQR(new Uint8ClampedArray(pixels), 384, 384)?.data).toBe(
      `${origin}/@jamie_rivera`,
    );
    await page.close();
  });

  it("renders owner edits safely and keeps them after a new Clerk synchronization", async () => {
    await owner.mutation(api.profiles.updatePublic, {
      displayName: "<img src=x onerror=alert(1)>",
      bio: "<script>alert('private')</script>",
    });
    await database.mutation(api.profiles.seedIdentity, {
      key,
      clerkUserId: "private-clerk-id",
      suggestedName: "Google changed name",
    });
    const page = await browser.newPage();
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(`${origin}/@jamie_rivera`);
    await browserExpect(
      page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" }),
    ).toBeVisible();
    await browserExpect(
      page.getByText("<script>alert('private')</script>", { exact: true }),
    ).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
    await page.close();
  });
});
