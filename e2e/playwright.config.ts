import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Target Naru's app/ workspace. Keep the template fallback for scaffold tooling
// that also uses this Playwright configuration.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Target = { name: string; cwd: string; port: number };

function resolveTargets(): Target[] {
  const appDir = resolve(repoRoot, "app");

  if (existsSync(appDir)) {
    return [{ name: "app", cwd: appDir, port: 5180 }];
  }

  const templatesDir = resolve(repoRoot, "templates");

  const frameworks = existsSync(templatesDir)
    ? readdirSync(templatesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

  return frameworks.map((name, i) => ({
    name,
    cwd: resolve(templatesDir, name),
    port: 5181 + i,
  }));
}

const targets = resolveTargets();

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  projects: targets.map((t) => ({
    name: t.name,
    use: {
      ...devices["Desktop Chrome"],
      baseURL: `http://localhost:${t.port}`,
    },
  })),
  webServer: targets.map((t) => ({
    // Run only the dev server (not `npm start`, which also spawns the
    // contract-watch process that needs Docker/network).
    command: `pnpm exec next dev --port ${t.port}`,
    cwd: t.cwd,
    url: `http://localhost:${t.port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  })),
});
