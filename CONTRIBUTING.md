# Contributing to Naru

This is the existing Naru workspace. See [README.md](README.md) for setup,
environment variables, and available checks.

- `app/` contains the Next.js app, reusable UI primitives, routes, and providers.
- `app-lib/` contains shared Stellar and wallet utilities. Its package name,
  `@stellar-scaffold/app-lib`, is retained because the Stellar Scaffold CLI
  generates contract clients that import it.
- `contracts/` contains reusable Soroban examples and the contract toolchain.
- `e2e/` retains Playwright configuration for future app tests.

Run `pnpm --dir app dev` for app-only development. `pnpm dev` additionally
starts the Stellar Scaffold contract-client watcher in Turbo's interactive view
and requires its CLI tools. New workspace packages with a `dev` script join the
same view automatically.
Use `pnpm lint`, `pnpm format:check`, `pnpm --dir app typecheck`,
`pnpm --dir app build`, and `cargo test --workspace` for checks.
