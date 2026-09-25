# Slice 1: passkey smart-account validation

Open `/dev/smart-account`. This is a testnet-only engineering screen, using
**test XLM (no monetary value)**. The normal homepage and scaffold configuration
are independent of it.

## Implementation choice and verified sources

Researched through Stellar Raven and checked against published source on
**2026-09-25**:

- [`smart-account-kit` 0.8.0](https://github.com/stellar/smart-account-kit):
  OpenZeppelin context-rule accounts and a separate WebAuthn verifier. Its
  published peer range is Stellar SDK `^16.3.0`; Naru pins `16.3.0`, already
  resolved by the workspace. No custom wallet contract is introduced.
- The kit's supported **manual submission API** is
  `createWallet(..., { autoSubmit: false }) → relayerPayload: { func, auth }`.
  `credentials.deploy(id, { autoSubmit: false })` rebuilds a failed deployment
  for the _existing_ credential. `connectWallet({ fresh: true })` prompts for
  the passkey and checks code identity, immutable deployment history, and the
  current on-chain signer. `signAuthEntry(..., { contextRuleIds: [0], expiration })`
  creates the account's WebAuthn authorization, including the Protocol 27 digest.
- [OpenZeppelin deployment manifest](https://github.com/stellar/smart-account-kit/blob/main/docs/deployments-protocol-27-2026-07-09.md):
  the uploaded account WASM and deployed testnet WebAuthn verifier are pinned in
  `app/src/lib/smart-account/shared.ts`. Account WASM is instantiated per user.
  No indexer, factory deployment, or hosted infrastructure modification is needed.
- [OpenZeppelin Channels](https://developers.stellar.org/docs/tools/openzeppelin-relayer)
  is a supported alternative: server-side `ChannelsClient({ baseUrl, apiKey })`
  with `submitSorobanTransaction({ func, auth })`, followed by RPC confirmation.
  Its hosted testnet service requires an API key. For this bounded single-source
  validation, Naru uses the documented manual payload with Stellar SDK/RPC and
  its own dedicated backend fee source. This avoids another service credential
  and makes durable deduplication and the sponsor's fee cap explicit.
- [Simulation authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation#enforcing-mode):
  record unsigned authorization, obtain the passkey signature, then simulate
  with `authMode: "enforce"` before assembling and signing the sponsor envelope.
  A submitted hash is not confirmation; only RPC `SUCCESS` supplies confirmation.

The kit integration is **not independently audited**. Its README distinguishes
that from the underlying contracts' separate audit and notes the deployed
revision is later than the audited revision. This slice only uses test funds.
Raven's repository index identified `stellar/smart-account-kit` (last indexed
commit 2026-09-18) and the moved `kalepail` repository; API decisions were checked
against the actual 0.8.0 package/source, not directory metadata or older guestbook
tutorials using Passkey Kit/Launchtube.

## Local setup

Use **Node 24** (or Node >=22.13 with `node:sqlite` support), the existing pnpm
version, and a browser with WebAuthn/user verification. No extension is needed.

1. Create **two dedicated Stellar testnet accounts**, sponsor and recipient,
   using Stellar CLI/Lab. Retain the sponsor secret in `app/.env.local` only.
   Never use an existing real-funds account or the kit's public default deployer.
2. Fund each **G-address** at `https://friendbot.stellar.org/?addr=G_ADDRESS`.
   The sponsor must have at least 5.5 test XLM for the preflight check.
3. Set in `app/.env.local` (see `app/.env.example`):

   ```dotenv
   NARU_SMART_ACCOUNT_ORIGIN=http://localhost:3000
   NARU_SMART_ACCOUNT_RP_ID=localhost
   NARU_SMART_ACCOUNT_SPONSOR_SECRET=S_YOUR_DEDICATED_TESTNET_SPONSOR
   NARU_SMART_ACCOUNT_RECIPIENT=G_YOUR_FUNDED_TESTNET_RECIPIENT
   ```

4. Run `pnpm --dir app dev --hostname localhost --port 3000`, then open
   `http://localhost:3000/dev/smart-account`.

These variables are server configuration, not `NEXT_PUBLIC_` values. Only the
public origin, RP ID, recipient, sponsor address, and asset address reach the
browser. The flow ignores the scaffold's local/mainnet network selection.

The backend sends a **5 test XLM native SAC transfer** to the deployed C-address.
Friendbot cannot fund C-addresses directly. The sponsor's balance comes from
Friendbot; funding is not a pretend balance or token mint.

Funding includes an explicit `sorobanCredentialsSourceAccount` authorization
entry scoped to that exact SAC transfer. The sponsor's transaction-envelope
signature satisfies it; an empty authorization array fails enforcing simulation
even when the sponsor is the transaction source. This was reproduced on testnet
(ledger 4866447), and the same simulation succeeded with the source-account entry
(ledger 4866448). These were read-only simulations, not submitted transfers.
The patched funding builder also passed enforcing simulation at ledger 4866468,
with an assembled fee of 414409 stroops (0.0414409 test XLM). All 7 focused tests,
typecheck, and production build passed after the fix.
If an earlier funding attempt shows `Error(Auth, InvalidAction)`, reload/restore
and click **Fund with 5 test XLM** again after updating. The failed simulation
spent no funds; retain the same account/passkey and its failed-attempt history.

## Stable HTTPS deployment and gating

- Outside local development, both page and API default to **404**. Enable with
  `NARU_SMART_ACCOUNT_ENABLED=true`, a random
  `NARU_SMART_ACCOUNT_ACCESS_TOKEN` of at least 32 characters, an exact stable
  HTTPS origin, and a matching RP ID (hostname only). The outer HTTP Basic gate
  uses username `naru` and that token; page and API repeat access enforcement.
- Use one Node deployment with persistent local disk. Set
  `NARU_SMART_ACCOUNT_DB` to an absolute SQLite path whose parent already exists
  and is writable only by the app user. Back up this file with account metadata.
  All processes using this sponsor must share this same local database. Do not
  use its secret in another app/CLI that also consumes its account sequence.
- Vercel/AWS Lambda execution is rejected. Ephemeral/serverless or independently
  scaled replicas need a shared transactional store/queue before sponsorship can
  be enabled. A stable HTTPS hostname on a persistent Node host is supported.
- Changing localhost's port changes its **origin** and IndexedDB storage;
  `localhost` and `127.0.0.1` are not interchangeable. Localhost passkeys do not
  become credentials for the HTTPS deployment.
- Random preview domains are intentionally not inferred or allowlisted. Their
  RP IDs/storage differ and credentials may become inaccessible. Use a stable
  HTTPS development hostname with its own passkeys; do not use a hosting
  provider's shared parent domain as the RP ID.

## Restoration, data, and failures

The adapter (`app/src/lib/smart-account/adapter.ts`) is independent of the page.
IndexedDB stores the kit's public credential ID/key, C-address, public deployment
provenance, and session metadata. Private passkey keys remain in the platform
authenticator/passkey provider: Naru never receives, stores, or exports them.
Signed payment authorization is transient in the browser. The backend stores
transaction intent, signed envelope/hash, outcome/ledger, and abuse counters.

Every reload starts locked. **Restore with passkey** performs a native prompt
and verifies the selected account equals the saved account. A failed restore
does not call account creation. Failed/partial creation retains its credential;
**Resume deployment** rebuilds for that same account. Do not clear IndexedDB to
retry a deployment.

This implements **same-browser restoration**, not cross-device recovery.
Credential syncing alone is insufficient: fresh-device discovery would also
need supported schema-2 provenance/indexing or an explicit metadata recovery
design. Neither is configured here. There is no automatic replacement wallet.

Cancellation, unsupported browsers, setup failures, insufficient test balances,
simulation failures, pending submissions, and on-chain failures have distinct
paths. RPC outages and `NOT_FOUND` remain unconfirmed. Account expiration,
archived state, or a testnet reset requires operator investigation; the app
never treats missing state as permission to create a replacement account.

## Sponsorship boundaries

- Fixed testnet RPC/passphrase, account WASM, verifier, native asset contract,
  **0.1 test XLM** amount, and server-configured recipient.
- Deployment compares the complete constructor, deterministic address/salt,
  public signer, deployer identity, and authorization tree. No policies or
  additional sub-invocations are accepted.
- Transfer review expires in two minutes; auth expires 60 ledgers after the
  recording simulation. Both browser and server bind the displayed transfer
  to the authorization. The backend accepts only a signature on its stored
  intent, never an arbitrary client transaction/envelope.
- Enforcing simulation validates auth before sponsor signing. Total envelope
  fee is capped at **0.5 test XLM**. The shared public kit deployer is sign-only;
  it never receives sponsor funds or supplies transaction sequence/fees.
- SQLite uniqueness/atomic reservation permits one in-flight sponsor envelope.
  The exact signed envelope/hash is durably saved **before** submission. Retry
  sends that same envelope; it does not rebuild a second payment. Confirmed
  funding is limited to one grant per account, across restarts/processes.
- Global durable limits: 10 deployment attempts/day, 60 submission attempts/day,
  100 reviews/day, 30 writes/minute, 180 reads/minute. UTC day boundaries apply.
  Limits do not depend on untrusted forwarded IP headers. Bodies are capped at
  40 KB, schemas are strict, mutations require same-origin JSON, and responses
  are uncached.

If a process dies during **preparing**, submission has not been persisted or
broadcast by that job. Stop the app, inspect the database, and mark only that
hashless job failed before restarting. A **pending** job with a hash must be
reconciled against RPC/testnet Horizon history; do not delete it or reset the
database to bypass the lock. After RPC retention or transaction expiry, unknown
status deliberately blocks new spending. Only a verified successful/failed
chain receipt should resolve an ambiguous broadcast. Keep the receipt evidence.

## Manual acceptance and evidence

1. Create a passkey. Wait for deployment **confirmed**, then record its C-address,
   transaction hash, and ledger from the screen.
2. Reload. Click **Restore with passkey**. Select the original passkey and verify
   the exact same C-address. Try cancelling a prompt; verify no new account.
3. Fund with 5 test XLM. Wait for **confirmed** and balance `5.0000000`.
4. Review `0.1` test XLM, the configured recipient, native asset, and testnet.
   Cancel once; verify no transfer. Review again, explicitly authorize and send.
5. Wait for **confirmed**, record the transfer hash/ledger, and verify balance
   `4.9000000` after the first payment (fees came from the sponsor). Check the
   recipient's testnet history and the source/fee in Stellar Expert.
6. Reload while pending and use Refresh. Verify the same hash and no duplicate
   debit. Check that outside-development requests are hidden/challenged.

**Evidence from implementation session (2026-09-25):** live RPC reported the
testnet passphrase, protocol 28, and ledger **4857823**; the pinned account WASM
was present and the WebAuthn verifier's on-chain WASM matched
`e63a030d0f1a1481e36059a4837c433083b33e704c1f9625b7314795b6d72b76`.
No account creation or payment transaction is claimed from this session.
The local endpoint/browser reported missing `NARU_SMART_ACCOUNT_SPONSOR_SECRET`;
creation stayed disabled with no browser runtime errors. Set the sponsor and
recipient above and complete the native prompts to finish acceptance.

The published kit also generated a real testnet **simulation-only** manual
deployment payload (CreateContractV2, one authorization), which Naru's deployment
policy accepted. That probe used public fixture credential metadata: it did not
create a passkey, submit a transaction, or provision an account. A separate
browser initialization probe with fixture configuration verified the kit's
browser bundle/Buffer setup; it likewise made no transactions.

Production-server probes returned **404** for the validation page and API with
the feature disabled, while the homepage returned **200**. A cross-origin POST
was rejected with **403**.

## Checks

```bash
pnpm --dir app test:smart-account
pnpm lint
pnpm format:check
pnpm --dir app typecheck
pnpm --dir app build
```

Focused tests exercise deployment restrictions, reviewed-auth tampering,
browser review binding, durable duplicate/concurrent submission protection,
funding limits, expired intents, budgets, and nonlocal gating. They do not
substitute for native-passkey testnet acceptance.

Implementation-session results: all **5 focused tests**, typecheck, build,
changed-code Oxlint/format checks, and `git diff --check` passed. Full workspace
lint remains blocked by pre-existing findings in `ui/label.tsx`, `ui/sonner.tsx`,
and `ui/drawer.tsx`. The full formatting check also reports pre-existing styles
in `globals.css`, shared `ui/*` components, and `lib/utils.ts`. Those files and
lint/Next.js configuration were preserved.
