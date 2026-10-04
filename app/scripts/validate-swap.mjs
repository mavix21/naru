import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

// Opt-in live test. Uses the real app, Clerk development, Convex and Testnet.
// Keep browser state and the virtual passkey outside the repository.
const dir = process.env.NARU_SWAP_E2E_DIR;
const origin = process.env.NARU_SMART_ACCOUNT_ORIGIN || "http://localhost:3000";
if (
  !dir ||
  new URL(origin).hostname !== "localhost" ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
) {
  throw new Error(
    "Set NARU_SWAP_E2E_DIR to a private scratch directory and use localhost with a Clerk development key.",
  );
}
process.umask(0o077);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const statePath = `${dir}/state.json`;
const state = await fs
  .readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch(() => ({}));

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
      `Clerk ${path}: ${data.errors?.map((error) => error.long_message ?? error.message).join("; ") ?? response.status}`,
    );
  return data;
}

if (!state.userId) {
  const user = await clerk("users", {
    email_address: [`naru-swap-${Date.now()}+clerk_test@example.com`],
    first_name: "Swap validation",
    skip_password_requirement: true,
  });
  state.userId = user.id;
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
}
const ticket = await clerk("sign_in_tokens", {
  user_id: state.userId,
  expires_in_seconds: 180,
});
const browser = await chromium.launchPersistentContext(`${dir}/browser`, {
  headless: true,
  viewport: { width: 1280, height: 950 },
});
const page = browser.pages()[0] ?? (await browser.newPage());
page.setDefaultTimeout(45000);
let authorization;
page.on("request", (request) => {
  if (
    new URL(request.url()).pathname !== "/api/swaps" ||
    request.method() !== "POST"
  )
    return;
  const body = request.postDataJSON();
  if (body.action === "authorize") authorization = body;
});
const cdp = await browser.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
for (const credential of state.credentials ?? []) {
  await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
}

const payments = () =>
  page.evaluate(async (userId) => {
    const response = await fetch("/api/payments", {
      headers: { "X-Naru-User": userId },
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  }, state.userId);

try {
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
    { ticket: ticket.token, userId: state.userId },
  );
  await page.goto(`${origin}/home`);
  await page.waitForTimeout(3000);
  if (await page.getByLabel("Companion name").isVisible()) {
    await page.getByLabel("Companion name").fill("Swap Naru");
    await page.getByRole("button", { name: /^Continue/ }).click();
    await page.getByRole("button", { name: /^Save companion/ }).click();
    await page.waitForTimeout(2500);
  }
  if (await page.getByPlaceholder("your_name").isVisible()) {
    await page.getByLabel("Your display name").fill("Swap validation");
    await page
      .getByPlaceholder("your_name")
      .fill(`swaptest${Date.now().toString().slice(-10)}`);
    await page
      .getByRole("button", { name: "Save username", exact: true })
      .click();
    await page.waitForTimeout(2500);
  }
  let payment = await payments();
  if (payment.state !== "ready") {
    await page
      .getByRole("button", {
        name: /^(Activate payments|Resume activation|Retry activation)$/,
      })
      .click();
    for (let count = 0; count < 24; count++) {
      await page.waitForTimeout(5000);
      payment = await payments();
      if (payment.state === "ready") break;
      if (payment.job?.state === "failed") throw new Error(payment.job.error);
      const errors = (await page.getByRole("alert").allTextContents()).filter(
        (text) => text.trim(),
      );
      if (errors.length) throw new Error(errors.join("; "));
    }
  }
  if (payment.state !== "ready")
    throw new Error("Account activation did not confirm.");
  const home = page.getByRole("button", { name: "Go home", exact: true });
  if (await home.isVisible()) await home.click();
  else await page.goto(`${origin}/home`);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  if (BigInt(payment.balance ?? "0") < BigInt(10000000)) {
    await page
      .getByRole("button", { name: "Add test XLM", exact: true })
      .click();
    for (let count = 0; count < 20; count++) {
      await page.waitForTimeout(5000);
      payment = await payments();
      if (payment.funding?.state === "confirmed") break;
      if (payment.funding?.state === "failed")
        throw new Error(payment.funding.error);
    }
  }
  const before = await payments();
  await page.keyboard.press("Escape");
  const existing = page
    .getByRole("article", { name: "Swap XLM for USDC" })
    .last();
  if (
    !(await existing.isVisible()) ||
    (await existing
      .getByText(/Swap failed|Cancelled|Swapped · confirmed/)
      .count())
  ) {
    await page
      .getByPlaceholder("Talk to Swap Naru…")
      .fill(
        "Swap exactly 1 XLM for USDC in my own account. Prepare the live quote for me to review.",
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
  }
  const card = page.getByRole("article", { name: "Swap XLM for USDC" }).last();
  await card.waitFor({ timeout: 120000 });
  const refresh = card.getByRole("button", { name: "Get new quote" });
  if (await refresh.isVisible()) await refresh.click();
  const confirm = card.getByRole("button", { name: "Confirm with passkey" });
  await confirm.waitFor();
  await page.screenshot({ path: `${dir}/review.png`, fullPage: true });
  await confirm.click();
  await card
    .getByText("Swapped · confirmed", { exact: true })
    .or(card.getByText("Swap failed", { exact: true }))
    .waitFor({ timeout: 150000 });
  if (await card.getByText("Swap failed", { exact: true }).isVisible())
    throw new Error(await card.innerText());
  const receipt = await card
    .getByRole("link", { name: /View confirmed receipt/ })
    .getAttribute("href");
  const after = await payments();
  if (BigInt(before.balance) - BigInt(after.balance) !== BigInt(10000000))
    throw new Error("XLM spend mismatch.");
  if (BigInt(after.usdcBalance) <= BigInt(before.usdcBalance))
    throw new Error("USDC was not received.");
  const hash = receipt.split("/").pop();
  if (!authorization)
    throw new Error("No explicit swap authorization was observed.");
  const replay = await page.evaluate(
    async ({ userId, authorization }) => {
      const response = await fetch("/api/swaps", {
        method: "POST",
        headers: { "X-Naru-User": userId, "Content-Type": "application/json" },
        body: JSON.stringify(authorization),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value.operation;
    },
    { userId: state.userId, authorization },
  );
  const replayBalance = await payments();
  if (
    replay.hash !== hash ||
    replay.state !== "confirmed" ||
    replayBalance.balance !== after.balance ||
    replayBalance.usdcBalance !== after.usdcBalance
  )
    throw new Error(
      "Replaying authorization changed the confirmed swap or balances.",
    );
  state.hash = hash;
  console.log(
    "CONFIRMED",
    JSON.stringify({
      hash,
      receipt,
      account: after.account,
      xlmBefore: before.balance,
      xlmAfter: after.balance,
      usdcBefore: before.usdcBalance,
      usdcAfter: after.usdcBalance,
      actualUSDCUnits: (
        BigInt(after.usdcBalance) - BigInt(before.usdcBalance)
      ).toString(),
      duplicateExecutionPrevented: true,
    }),
  );
  await page.screenshot({ path: `${dir}/confirmed.png`, fullPage: true });
} catch (error) {
  console.error("Swap validation failed:", error.message);
  console.log(
    "Visible app state:",
    (await page.locator("body").innerText()).slice(-6000),
  );
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true });
  process.exitCode = 1;
} finally {
  state.credentials = (
    await cdp.send("WebAuthn.getCredentials", { authenticatorId })
  ).credentials;
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  await browser.close();
}
