# Naru

Naru is a web-first personal money assistant for everyday people. The intended
experience centers on a customizable bird companion; Naru is the product name,
while each person's companion will have its own name. Stellar is the intended
payment infrastructure.

## Get started

Use Node.js 22 or newer and pnpm 11.25.0 (the version in `package.json`). From
the repository root:

```bash
pnpm install
pnpm --dir app dev
```

Visit http://localhost:3000. `pnpm --dir app dev` starts the Next.js app without
requiring the Stellar CLI, a local network, or traffic API credentials.

For contract development, install Rust with the target from the
[Stellar smart contract setup guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup),
the Stellar CLI, and the Stellar Scaffold CLI. `pnpm dev` then runs the existing
contract-client watcher alongside Next.js. The retained example contracts and
their build configuration live in `contracts/` and `environments.toml`.

## Environment

No environment variables are required to view the current homepage. The
existing wallet and Stellar utilities use local-network defaults when network
values are unset. For explicit settings, copy `app/.env.example` to
`app/.env.local` and configure:

- `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_STELLAR_HORIZON_URL`

The example also includes `STELLAR_SCAFFOLD_ENV` and `XDG_CONFIG_HOME` for the
optional scaffold/contract workflow. A reachable Stellar network is needed
when using wallet or contract functionality, but not to render the homepage.

## Current status

The app currently renders a minimal responsive Naru page. The repository still
contains its Next.js, TypeScript, Tailwind/shadcn, wallet, Stellar, and Soroban
foundation, including generic example contracts and a contract debug route.
There is no companion setup, authentication flow, payment flow, bill splitting,
or financial logic implemented yet.

Planned experiences include sending and receiving money, splitting bills and
managing payment requests with a companion, and eventually sending money to an
email address before its owner has an account. These are plans, not working
features.

**Next slice:** companion identity onboarding: choose a companion name, avatar,
and color with a live preview.

## Checks

```bash
pnpm lint
pnpm format:check
pnpm --dir app typecheck
pnpm --dir app build
cargo test --workspace
```

The `e2e/` workspace retains Playwright configuration for future app tests.

The scaffold-derived tooling is credited to
[Stellar Scaffold](https://github.com/stellar-scaffold/cli); the shared
`@stellar-scaffold/app-lib` package name is retained for generated client
compatibility. See `LICENSE` for licensing details.
