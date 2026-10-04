import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

// Opt-in real two-user flow: Clerk dev, accepted friendship, virtual passkeys,
// existing swap, sponsored Testnet send, receipt delivery and replay protection.
const dir = process.env.NARU_TRANSFER_E2E_DIR;
const origin = process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000";
if (
  !dir ||
  new URL(origin).hostname !== "localhost" ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
)
  throw new Error(
    "Set NARU_TRANSFER_E2E_DIR to a private scratch directory; use localhost and a Clerk development key.",
  );
process.umask(0o077);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const statePath = `${dir}/state.json`;
const state = await fs
  .readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch(() => ({}));
if (state.hash)
  throw new Error(
    `This run already confirmed ${state.hash}. Use a new scratch directory for another transfer.`,
  );
const sessions = [];
const persist = () =>
  fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

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

async function api(session, path, body) {
  return session.page.evaluate(
    async ({ userId, path, body }) => {
      const response = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: { "X-Naru-User": userId, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    },
    { userId: session.state.userId, path, body },
  );
}

async function open(role) {
  state[role] ??= { username: `tx${role}${Date.now().toString().slice(-10)}` };
  const saved = state[role];
  if (!saved.userId) {
    const user = await clerk("users", {
      email_address: [
        `naru-transfer-${role}-${Date.now()}+clerk_test@example.com`,
      ],
      first_name: role === "recipient" ? "Ana" : "Transfer sender",
      skip_password_requirement: true,
    });
    saved.userId = user.id;
    await persist();
  }
  const ticket = await clerk("sign_in_tokens", {
    user_id: saved.userId,
    expires_in_seconds: 180,
  });
  const browser = await chromium.launchPersistentContext(`${dir}/${role}`, {
    headless: true,
    viewport: { width: 1280, height: 950 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  page.setDefaultTimeout(60000);
  const cdp = await browser.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  for (const credential of saved.credentials ?? [])
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  const session = { page, browser, cdp, authenticatorId, state: saved, role };
  sessions.push(session);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.Clerk?.loaded && window.Clerk?.client,
  );
  await page.evaluate(
    async ({ ticket, userId }) => {
      if (window.Clerk.user?.id === userId) return;
      const attempt = await window.Clerk.client.signIn.create({
        strategy: "ticket",
        ticket,
      });
      if (attempt.status !== "complete")
        throw new Error(`Sign-in ${attempt.status}`);
      await window.Clerk.setActive({ session: attempt.createdSessionId });
    },
    { ticket: ticket.token, userId: saved.userId },
  );
  await page.goto(`${origin}/home`);
  await page.waitForTimeout(2000);
  if (await page.getByLabel("Companion name").isVisible()) {
    await page.getByLabel("Companion name").fill("Transfer Naru");
    await page.getByRole("button", { name: /^Continue/ }).click();
    await page.getByRole("button", { name: /^Save companion/ }).click();
    await page.waitForTimeout(2000);
  }
  if (
    await page
      .getByPlaceholder("your_name")
      .filter({ visible: true })
      .isVisible()
  ) {
    await page
      .getByLabel("Your display name")
      .filter({ visible: true })
      .fill(role === "recipient" ? "Ana" : "Transfer sender");
    await page
      .getByPlaceholder("your_name")
      .filter({ visible: true })
      .fill(saved.username);
    await page
      .getByRole("button", { name: "Save username", exact: true })
      .filter({ visible: true })
      .click();
    await page.waitForTimeout(2000);
  }
  let payment = await api(session, "/api/payments");
  if (payment.state !== "ready") {
    await page
      .getByRole("button", {
        name: /^(Activate payments|Resume activation|Retry activation)$/,
      })
      .click();
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(5000);
      saved.credentials = (
        await cdp.send("WebAuthn.getCredentials", { authenticatorId })
      ).credentials;
      await persist();
      payment = await api(session, "/api/payments");
      if (payment.state === "ready") break;
      if (payment.job?.state === "failed") throw new Error(payment.job.error);
    }
  }
  if (payment.state !== "ready")
    throw new Error(`${role} activation not confirmed.`);
  const home = page.getByRole("button", { name: "Go home", exact: true });

  if (await home.isVisible()) await home.click();
  await page.goto(`${origin}/home`);
  await page.locator("#naru-message").waitFor();
  console.log(`${role}: activated`);
  return session;
}

try {
  const sender = await open("sender");
  const recipient = await open("recipient");
  const page = sender.page;
  if (!state.friends) {
    await page.getByRole("button", { name: "People", exact: true }).click();
    await page
      .getByLabel("Find a friend by exact username")
      .fill(recipient.state.username);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    const add = page.getByRole("button", { name: "Add friend", exact: true });
    await add
      .or(page.getByText("Already friends", { exact: true }))
      .or(page.getByText("Request pending", { exact: true }))
      .waitFor();
    if (await add.isVisible()) await add.click();
    await page.keyboard.press("Escape");
    await recipient.page
      .getByRole("button", { name: "People", exact: true })
      .click();
    const accept = recipient.page.getByRole("button", {
      name: "Accept",
      exact: true,
    });
    await accept
      .or(
        recipient.page.getByRole("button", {
          name: "Remove friend",
          exact: true,
        }),
      )
      .waitFor();
    if (await accept.isVisible()) await accept.click();
    await recipient.page
      .getByRole("button", { name: "Remove friend", exact: true })
      .waitFor();
    await recipient.page.keyboard.press("Escape");
    state.friends = true;
    await persist();
  }
  console.log("friendship: accepted");
  let authorization;
  let swapAuthorizations = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path !== "/api/transfers" && path !== "/api/swaps") return;
    const body = request.postDataJSON();
    if (body.action !== "authorize") return;
    if (path === "/api/transfers") authorization = body;
    else swapAuthorizations++;
  });
  const card = page
    .getByRole("article", { name: "Transfer to Ana", exact: true })
    .last();
  if (!(await card.isVisible())) {
    await page
      .locator("#naru-message")
      .fill(`Send 1 USDC to @${recipient.state.username}`);
    await page
      .getByRole("option")
      .filter({ hasText: recipient.state.username })
      .click();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await card.waitFor({ timeout: 150000 });
  }
  await expect(card).toContainText("1 USDC");
  if (await card.getByText("Sent · confirmed", { exact: true }).isVisible())
    throw new Error(
      "This transfer is already confirmed. Check its receipt; do not repeat it.",
    );
  let senderBefore = await api(sender, "/api/payments");
  if (senderBefore.usdcBalance === null)
    throw new Error("Official Testnet USDC balance unavailable.");
  if (BigInt(senderBefore.usdcBalance) < BigInt(10000000)) {
    await card.getByText(/You need .* more USDC/).waitFor();
    if (authorization || swapAuthorizations)
      throw new Error(
        "Shortfall initiated an automatic outgoing authorization.",
      );
    if (BigInt(senderBefore.balance) < BigInt(100000000)) {
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page
        .getByRole("button", { name: /^(Add test XLM|Get 1,000 test XLM)$/ })
        .click();
      await expect
        .poll(async () => (await api(sender, "/api/payments")).funding?.state, {
          timeout: 150000,
        })
        .toBe("confirmed");
      await page.keyboard.press("Escape");
    }
    const swap = page
      .getByRole("article", { name: "Swap XLM for USDC" })
      .last();
    if (
      !(await swap.isVisible()) ||
      (await swap.getByText(/^(Cancelled|Swap failed|Exchanged)$/).count())
    ) {
      await card.getByRole("button", { name: /Get USDC with a swap/ }).click();
      await expect(page.locator("#naru-message")).toHaveValue(
        /Swap enough XLM to receive/,
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
    }
    await swap.waitFor({ timeout: 150000 });
    await swap.scrollIntoViewIfNeeded();
    await swap.getByRole("button", { name: "Confirm exchange" }).click();
    await swap
      .getByText("Exchanged", { exact: true })
      .or(swap.getByText("Swap failed", { exact: true }))
      .waitFor({ timeout: 150000 });
    if (await swap.getByText("Swap failed", { exact: true }).isVisible())
      throw new Error(await swap.innerText());
    if (swapAuthorizations !== 1 || authorization)
      throw new Error("Swap and transfer were not separately authorized.");
    state.swapReceipt = await swap
      .getByRole("link", { name: "View receipt", exact: true })
      .getAttribute("href");
    await persist();
    console.log("shortfall: separately reviewed and authorized swap confirmed");
  }
  senderBefore = await api(sender, "/api/payments");
  const recipientBefore = await api(recipient, "/api/payments");
  await page.evaluate(() => {
    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async () => {
      navigator.credentials.get = original;
      throw new DOMException(
        "Test user rejected authorization",
        "NotAllowedError",
      );
    };
  });
  await card.getByRole("button", { name: "Confirm with passkey" }).click();
  await card.getByText(/Passkey not authorized/).waitFor();
  if (authorization) throw new Error("Rejected passkey was submitted.");
  await page.reload();
  await card.getByRole("button", { name: "Confirm with passkey" }).waitFor();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/review.png`, fullPage: true });
  await card.getByRole("button", { name: "Confirm with passkey" }).click();
  await card
    .getByText("Sent · confirmed", { exact: true })
    .or(card.getByText("Transfer failed", { exact: true }))
    .waitFor({ timeout: 150000 });
  if (await card.getByText("Transfer failed", { exact: true }).isVisible())
    throw new Error(await card.innerText());
  if (!authorization)
    throw new Error("No explicit transfer authorization observed.");
  const announcement = page.getByText(
    `Done — 1 USDC sent to @${recipient.state.username}.`,
    { exact: true },
  );
  await expect(announcement).toHaveCount(1);
  const receipt = await card
    .getByRole("link", { name: /Open transaction/ })
    .getAttribute("href");
  const hash = receipt.split("/").pop();
  state.hash = hash;
  await persist();
  const received = recipient.page
    .getByRole("article", { name: "Received payment" })
    .last();
  await expect(received).toContainText("1 USDC", { timeout: 60000 });
  await expect(
    received.getByRole("link", { name: /View confirmed receipt/ }),
  ).toHaveAttribute("href", receipt);
  const senderAfter = await api(sender, "/api/payments");
  const recipientAfter = await api(recipient, "/api/payments");
  if (
    BigInt(senderBefore.usdcBalance) - BigInt(senderAfter.usdcBalance) !==
      BigInt(10000000) ||
    BigInt(recipientAfter.usdcBalance) - BigInt(recipientBefore.usdcBalance) !==
      BigInt(10000000)
  )
    throw new Error("USDC debit/credit mismatch.");
  if (
    senderBefore.balance !== senderAfter.balance ||
    recipientBefore.balance !== recipientAfter.balance
  )
    throw new Error("User XLM changed despite sponsored fees.");
  const replay = await api(sender, "/api/transfers", authorization);
  const afterReplay = await api(sender, "/api/payments");
  if (
    replay.operation.hash !== hash ||
    replay.operation.state !== "confirmed" ||
    afterReplay.usdcBalance !== senderAfter.usdcBalance
  )
    throw new Error("Authorization replay changed the receipt or balance.");
  await expect(announcement).toHaveCount(1);
  await expect(
    recipient.page.getByRole("article", { name: "Received payment" }),
  ).toHaveCount(1);
  await recipient.page.getByRole("button", { name: /Notifications,/ }).click();
  await recipient.page.getByText(/sent you a payment · confirmed/).waitFor();
  const evidence = {
    hash,
    receipt,
    sender: senderAfter.account,
    recipient: recipientAfter.account,
    senderUSDCBefore: senderBefore.usdcBalance,
    senderUSDCAfter: senderAfter.usdcBalance,
    recipientUSDCBefore: recipientBefore.usdcBalance,
    recipientUSDCAfter: recipientAfter.usdcBalance,
    sponsoredFees: true,
    duplicateExecutionPrevented: true,
    recipientNotified: true,
    rejectedAuthorizationNotSubmitted: true,
    swapReceipt: state.swapReceipt,
  };
  await fs.writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2), {
    mode: 0o600,
  });
  console.log("CONFIRMED", JSON.stringify(evidence));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${dir}/confirmed.png` });
} catch (error) {
  console.error("Transfer validation failed:", error.message);
  for (const session of sessions) {
    console.log(
      `${session.role} visible state:`,
      (await session.page.locator("body").innerText()).slice(-7000),
    );
    await session.page.screenshot({
      path: `${dir}/${session.role}-failure.png`,
      fullPage: true,
    });
  }
  process.exitCode = 1;
} finally {
  for (const session of sessions) {
    session.state.credentials = (
      await session.cdp.send("WebAuthn.getCredentials", {
        authenticatorId: session.authenticatorId,
      })
    ).credentials;
    await persist();
    await session.browser.close();
  }
}
