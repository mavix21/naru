# Naru

Naru is a personal money assistant with a customizable bird companion, built
with Next.js, Clerk, Convex, and Stellar passkey smart accounts.

## Get started

Use Node.js 24+, pnpm 11.25.0, Rust, the Stellar CLI, Stellar Scaffold CLI,
and Docker. Merge settings from `app/.env.example` and `backend/.env.example`
into the respective `.env.local` files, preserving existing values.

```bash
pnpm install
pnpm dev          # Turbo: Next.js, contracts/client watcher, Convex
pnpm build        # Next.js build and backend typecheck; no deployment
```

Start Docker before `pnpm dev`, then open http://localhost:3000.
For Next.js only, use `pnpm --dir app dev`.

## Environment

- App auth: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `NEXT_PUBLIC_CONVEX_URL`. Use keys from the same Clerk Development instance
  with its Convex integration enabled.
- Convex CLI (`backend/.env.local`): `CONVEX_DEPLOYMENT`. Set
  `CLERK_JWT_ISSUER_DOMAIN` on that Convex deployment.
- Stellar overrides (local defaults): `NEXT_PUBLIC_STELLAR_NETWORK`,
  `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`, `NEXT_PUBLIC_STELLAR_RPC_URL`,
  `NEXT_PUBLIC_STELLAR_HORIZON_URL`, `STELLAR_SCAFFOLD_ENV`, `XDG_CONFIG_HOME`.
- Retained testnet sponsor infrastructure: `NARU_SMART_ACCOUNT_ORIGIN`,
  `NARU_SMART_ACCOUNT_RP_ID`, `NARU_SMART_ACCOUNT_SPONSOR_SECRET`,
  `NARU_SMART_ACCOUNT_RECIPIENT`; outside localhost development,
  `NARU_SMART_ACCOUNT_DB`, `NARU_SMART_ACCOUNT_ENABLED`, and
  `NARU_SMART_ACCOUNT_ACCESS_TOKEN`. Keep the existing persistent SQLite store
  and passkey origin. Sponsorship has no public route in this checkout.

## Checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
```

Tooling and example contracts derive from
[Stellar Scaffold](https://github.com/stellar-scaffold/cli); passkey integration
uses [Stellar Smart Account Kit](https://github.com/stellar/smart-account-kit).
See `LICENSE` and retained upstream attribution notices.
