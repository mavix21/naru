import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs/promises";

import { api } from "../../backend/convex/_generated/api.js";

// Runs the real /home workspace with dedicated Clerk development users and no wallets.
const dir = process.env.NARU_MESSAGING_E2E_DIR;
const origin = process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000";
if (
  !dir ||
  new URL(origin).hostname !== "localhost" ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
)
  throw new Error(
    "Set NARU_MESSAGING_E2E_DIR to a private scratch directory and use localhost with Clerk development keys.",
  );
process.umask(0o077);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const sessions = [];
const run = Date.now().toString().slice(-10);
const pageErrors = [];

async function clerk(path, body) {
  const response = await fetch(`https://api.clerk.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `Clerk ${path}: ${data.errors?.map((e) => e.long_message ?? e.message).join("; ") ?? response.status}`,
    );
  return data;
}

async function open(role, displayName, accent) {
  const user = await clerk("users", {
    email_address: [`naru-dm-${role}-${run}+clerk_test@example.com`],
    first_name: displayName,
    skip_password_requirement: true,
  });
  const ticket = await clerk("sign_in_tokens", {
    user_id: user.id,
    expires_in_seconds: 180,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const sockets = [];
  let offline = false;
  await context.routeWebSocket(/convex\.cloud/, (route) => {
    if (offline) {
      route.close();
      return;
    }
    const server = route.connectToServer();
    sockets.push({ route, server });
  });
  const setOffline = async (value) => {
    offline = value;
    if (value)
      for (const { route, server } of sockets.splice(0)) {
        route.close();
        server.close();
      }
    await context.setOffline(value);
  };
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) =>
    pageErrors.push({ role, error: error.message }),
  );
  await page.goto(origin);
  await page.waitForFunction(
    () => window.Clerk?.loaded && window.Clerk?.client,
  );
  await page.evaluate(async (ticket) => {
    const attempt = await window.Clerk.client.signIn.create({
      strategy: "ticket",
      ticket,
    });
    if (attempt.status !== "complete")
      throw new Error(`Sign-in ${attempt.status}`);
    await window.Clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.goto(`${origin}/create`);
  await page.waitForFunction(
    () => window.Clerk?.loaded && window.Clerk?.session,
  );
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  let refreshedAt = 0;
  const refresh = async () => {
    client.setAuth(
      await page.evaluate(async () => {
        const token = await window.Clerk.session.getToken({ skipCache: true });
        const claims = JSON.parse(
          atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        return claims.aud === "convex"
          ? token
          : window.Clerk.session.getToken({
              template: "convex",
              skipCache: true,
            });
      }),
    );
    refreshedAt = Date.now();
  };
  const authenticated = Object.fromEntries(
    ["query", "mutation"].map((method) => [
      method,
      async (...args) => {
        if (Date.now() - refreshedAt > 20_000) await refresh();
        return client[method](...args);
      },
    ]),
  );
  await refresh();
  await client.mutation(api.companions.save, { name: "Naru", accent });
  await client.mutation(api.social.claimUsername, {
    username: `dm${role}${run}`,
    displayName,
  });
  await client.mutation(api.companions.finishPaymentPrompt, {});
  const social = await client.query(api.social.current, {});
  const session = {
    context,
    setOffline,
    page,
    client: authenticated,
    refresh,
    userId: user.id,
    profileId: social.me.userId,
    role,
    displayName,
  };
  sessions.push(session);
  await page.goto(`${origin}/home`);
  await expect(
    page.getByRole("heading", { name: "Chats", exact: true }),
  ).toBeVisible();
  return session;
}

async function sendUI(session, recipient, text) {
  await session.page.bringToFront();
  await session.page
    .getByRole("textbox", { name: `Message ${recipient}` })
    .fill(text);
  await session.page
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    session.page.getByRole("log").getByText(text, { exact: true }),
  ).toHaveCount(1);
  await expect(session.page.getByText("Sending…", { exact: true })).toHaveCount(
    0,
    { timeout: 30_000 },
  );
}

try {
  const alice = await open("alice", "Alex Chen", "sky");
  const bob = await open("bob", "Maya Rivera", "coral");
  const outsider = await open("outsider", "Jordan Lee", "sunshine");
  await alice.client.mutation(api.social.friendAction, {
    personId: bob.profileId,
    action: "send",
  });
  await bob.client.mutation(api.social.friendAction, {
    personId: alice.profileId,
    action: "accept",
  });
  const privateBefore = await Promise.all(
    [alice, bob].map((s) => s.client.query(api.conversations.current, {})),
  );
  await alice.page.bringToFront();
  await alice.page
    .getByRole("button", { name: "New message", exact: true })
    .click();
  await alice.page.getByRole("button", { name: /Maya Rivera/ }).click();
  await expect(
    alice.page.getByRole("textbox", { name: "Message Maya Rivera" }),
  ).toBeVisible();
  const conversationId = new URL(alice.page.url()).searchParams.get("chat");
  expect(
    await bob.client.mutation(api.directMessages.start, {
      friendId: alice.profileId,
    }),
  ).toBe(conversationId);
  const greeting = "Hey Maya, are we still on for Saturday?";
  await sendUI(alice, bob.displayName, greeting);
  await expect(
    bob.page.getByRole("button", { name: "Alex Chen, 1 unread", exact: true }),
  ).toBeVisible();
  await bob.page.bringToFront();
  await bob.page
    .getByRole("button", { name: "Alex Chen, 1 unread", exact: true })
    .click();
  await expect(
    bob.page.getByRole("log").getByText(greeting, { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await bob.client.query(api.directMessages.detail, { conversationId }))
          .unread,
    )
    .toBe(0);
  await sendUI(
    bob,
    alice.displayName,
    "Yes! Let’s meet at 10. There’s a new café by the park.",
  );
  await expect(
    alice.page
      .getByRole("log")
      .getByText("Yes! Let’s meet at 10. There’s a new café by the park.", {
        exact: true,
      }),
  ).toBeVisible();
  await alice.page.reload();
  await expect(
    alice.page.getByRole("log").getByText(greeting, { exact: true }),
  ).toBeVisible();
  console.log(
    "PASS: friend picker, pair reuse, two-user realtime, reload persistence, unread",
  );

  const historyArgs = {
    conversationId,
    paginationOpts: { numItems: 50, cursor: null },
  };
  const denied = [];
  for (const [operation, args, mutation] of [
    [api.directMessages.detail, { conversationId }, false],
    [api.directMessages.history, historyArgs, false],
    [
      api.directMessages.send,
      { conversationId, clientId: "intrusion", text: "Forbidden" },
      true,
    ],
    [api.directMessages.markRead, { conversationId, throughSequence: 1 }, true],
  ]) {
    try {
      await outsider.client[mutation ? "mutation" : "query"](operation, args);
      denied.push(false);
    } catch {
      denied.push(true);
    }
  }
  expect(denied).toEqual([true, true, true, true]);
  expect(
    (await outsider.client.query(api.directMessages.inbox, {})).conversations,
  ).toEqual([]);
  console.log("PASS: unauthorized reads/writes denied");

  await alice.page.bringToFront();
  await alice.setOffline(true);
  await expect(alice.page.getByText(/Reconnecting…/)).toBeVisible();
  const offlineText = "Perfect. I’ll bring the book I told you about.";
  await alice.page
    .getByRole("textbox", { name: "Message Maya Rivera" })
    .fill(offlineText);
  await alice.page
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    alice.page.getByText("Waiting for connection…", { exact: true }),
  ).toBeVisible();
  const storageKey = `naru:dm:v1:${alice.userId}:${conversationId}`;
  const interrupted = await alice.page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    storageKey,
  );
  await alice.setOffline(false);
  await expect(
    bob.page.getByRole("log").getByText(offlineText, { exact: true }),
  ).toBeVisible();
  // Simulate a reload after commit but before the browser persisted its acknowledgement.
  await alice.page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: interrupted },
  );
  await alice.page.reload();
  await expect(
    alice.page.getByRole("log").getByText(offlineText, { exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      alice.page.evaluate(
        (key) => !!JSON.parse(localStorage.getItem(key)).pending,
        storageKey,
      ),
    )
    .toBe(false);
  const replay = { conversationId, ...interrupted.pending };
  await alice.client.mutation(api.directMessages.send, replay);
  expect(
    (
      await alice.client.query(api.directMessages.history, historyArgs)
    ).page.filter((m) => m.clientId === replay.clientId),
  ).toHaveLength(1);
  console.log(
    "PASS: offline sending and lost-acknowledgement retries without duplicates",
  );

  // Fill the actual server rate bucket; exercise a visible failure and same-ID retry.
  for (let i = 0; i < 65; i++) {
    try {
      await alice.client.mutation(api.directMessages.send, {
        conversationId,
        clientId: `history-${i}`,
        text: `Saturday plans · note ${i + 1}`,
      });
    } catch (error) {
      if (!error.message.includes("pause")) throw error;
      break;
    }
  }
  const retryText = "I found it — the café is called Little Things.";
  await alice.page
    .getByRole("textbox", { name: "Message Maya Rivera" })
    .fill(retryText);
  await alice.page
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    alice.page.getByRole("button", { name: "Retry message", exact: true }),
  ).toBeVisible();
  await alice.page.screenshot({ path: `${dir}/failed-send.png` });
  const failed = await alice.page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).pending,
    storageKey,
  );
  await alice.page.reload();
  await expect(
    alice.page.getByRole("button", { name: "Retry message", exact: true }),
  ).toBeVisible();
  await alice.page.waitForTimeout(60_500 - (Date.now() % 60_000));
  await Promise.all(sessions.map((s) => s.refresh()));
  await alice.page
    .getByRole("button", { name: "Retry message", exact: true })
    .click();
  await expect(
    bob.page.getByRole("log").getByText(retryText, { exact: true }),
  ).toBeVisible();
  await expect(
    alice.page.getByRole("button", { name: "Retry message", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await alice.client.query(api.directMessages.history, historyArgs)
    ).page.filter((m) => m.clientId === failed.clientId),
  ).toHaveLength(1);
  console.log("PASS: failed send survives reload; retry commits once");

  for (let i = 0; i < 15; i++)
    await bob.client.mutation(api.directMessages.send, {
      conversationId,
      clientId: `older-${i}`,
      text: `Café shortlist · ${i + 1}`,
    });
  await sendUI(
    bob,
    alice.displayName,
    "That’s the one! I’ve heard their coffee is really good ☕",
  );
  await sendUI(
    alice,
    bob.displayName,
    "A coffee, a walk, and absolutely no plans after. Sounds like a good Saturday.",
  );
  await sendUI(
    bob,
    alice.displayName,
    "Exactly what I had in mind. See you there! ✨",
  );
  await alice.page.reload();
  await expect(
    alice.page.getByRole("button", { name: "Earlier messages", exact: true }),
  ).toBeVisible();
  while (
    await alice.page
      .getByRole("button", { name: "Earlier messages", exact: true })
      .isVisible()
  ) {
    await alice.page
      .getByRole("button", { name: "Earlier messages", exact: true })
      .click();
    await expect(
      alice.page.getByRole("button", { name: "Loading…", exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    alice.page.getByRole("log").getByText(greeting, { exact: true }),
  ).toBeVisible();
  const visibleTexts = await alice.page
    .getByRole("log")
    .locator("p[dir=auto]")
    .allTextContents();
  let cursor = null;
  const all = [];
  do {
    const page = await alice.client.query(api.directMessages.history, {
      conversationId,
      paginationOpts: { numItems: 20, cursor },
    });
    all.push(...page.page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  expect(visibleTexts).toEqual([...all].reverse().map((m) => m.text));
  await alice.page.getByRole("log").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await alice.page
    .getByRole("textbox", { name: "Message Maya Rivera" })
    .fill("See you Saturday :)");
  await expect(
    alice.page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await alice.page.screenshot({ path: `${dir}/desktop.png` });
  await alice.page.setViewportSize({ width: 390, height: 844 });
  await expect(
    alice.page.getByRole("complementary", { name: "Conversations" }),
  ).toBeHidden();
  await expect(
    alice.page.getByRole("button", { name: "Back to chats", exact: true }),
  ).toBeVisible();
  await expect(
    alice.page
      .getByRole("log")
      .getByText("Exactly what I had in mind. See you there! ✨", {
        exact: true,
      }),
  ).toBeInViewport();
  await alice.page.screenshot({ path: `${dir}/mobile-thread.png` });
  await alice.page.setViewportSize({ width: 390, height: 520 });
  await expect(
    alice.page.getByRole("textbox", { name: "Message Maya Rivera" }),
  ).toBeInViewport();
  await expect(
    alice.page
      .getByRole("log")
      .getByText("Exactly what I had in mind. See you there! ✨", {
        exact: true,
      }),
  ).toBeInViewport();
  await alice.page.setViewportSize({ width: 390, height: 844 });
  await alice.page
    .getByRole("button", { name: "Back to chats", exact: true })
    .click();
  await expect(
    alice.page.getByRole("complementary", { name: "Conversations" }),
  ).toBeVisible();
  await alice.page.screenshot({ path: `${dir}/mobile-list.png` });
  await alice.page.setViewportSize({ width: 320, height: 720 });
  expect(
    await alice.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await alice.page
    .getByRole("button", {
      name: "Account, activity, and companion settings",
      exact: true,
    })
    .click();
  await alice.page
    .getByRole("button", { name: "Companion", exact: true })
    .click();
  await expect(alice.page.getByLabel("Companion name")).toBeVisible();
  await alice.page.keyboard.press("Escape");
  await alice.page.setViewportSize({ width: 390, height: 844 });
  await alice.page
    .getByRole("button", { name: "Your Naru", exact: false })
    .click();
  await expect(alice.page.locator("#naru-message")).toBeVisible();
  await alice.page.screenshot({ path: `${dir}/mobile-naru.png` });
  expect(
    await alice.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const privateAfter = await Promise.all(
    [alice, bob].map((s) => s.client.query(api.conversations.current, {})),
  );
  expect(privateAfter).toEqual(privateBefore);
  console.log(
    "PASS: history pagination/order, mobile list/thread/back, private Naru isolation",
  );

  await alice.page.setViewportSize({ width: 1440, height: 960 });
  await alice.page
    .getByRole("button", { name: "Maya Rivera", exact: true })
    .click();
  await alice.client.mutation(api.social.friendAction, {
    personId: bob.profileId,
    action: "remove",
  });
  await expect(alice.page.getByText(/You’re no longer friends/)).toBeVisible();
  await expect(bob.page.getByText(/You’re no longer friends/)).toBeVisible();
  expect(
    (await alice.client.query(api.directMessages.history, historyArgs)).page
      .length,
  ).toBeGreaterThan(0);
  await expect(
    alice.client.mutation(api.directMessages.send, {
      conversationId,
      clientId: "removed",
      text: "Should not send",
    }),
  ).rejects.toThrow();
  expect(pageErrors).toEqual([]);
  await fs.writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        ok: true,
        conversationId,
        messages: all.length,
        users: sessions.map((s) => ({ role: s.role, userId: s.userId })),
        pageErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: removal preserves history and blocks sends; no browser errors. Screenshots: ${dir}`,
  );
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (!page) continue;
    await page
      .screenshot({ path: `${dir}/failure-${index}.png` })
      .catch(() => {});
    await fs
      .writeFile(
        `${dir}/failure-${index}.txt`,
        `${page.url()}\n${await page
          .locator("body")
          .innerText()
          .catch(() => "Unavailable")}`,
      )
      .catch(() => {});
  }
  console.error("Browser errors:", pageErrors);
  throw error;
} finally {
  await browser.close();
}
