@AGENTS.md

## Commands

- `pnpm dev` from the repository root starts Next.js and Convex in Turbo.
- `pnpm --dir app dev` starts only Next.js (no local network needed).
- `pnpm --dir app build` runs the production build and typecheck.
- `pnpm --dir app start` serves the production build.
- `pnpm run lint`, `pnpm run format:check` run Oxlint and Oxfmt.

## Architecture

The App Router lives in `src/app`. Routes and layouts are server components;
interactive controls and browser-only passkey SDKs stay in client leaves.
The shared UI uses Cache Components and Partial Prefetching. Payments use pinned
Stellar Testnet contracts, with server configuration in `.env.example`.
