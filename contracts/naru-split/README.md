# NaruSplit — Testnet USDC reimbursements

Small, noncustodial Soroban contract. An organizer requests equal reimbursement;
each other participant separately authorizes their own payment directly to the
organizer. **Creating a request is not consent to pay or permission to charge.**

## Deployment and observed results

Validated **2026-10-05 UTC** (October 4 local development time), on Testnet protocol
29. Built with the repository's Rust **1.93.0**, resolved `soroban-sdk` **26.1.1**,
and installed Stellar CLI **23.1.4**.

- Contract: [`CCZMEGP4UDCQYQORCF6225SOMLLSUTC3OCPLNECLBOGFADM3AZZQ5EMF`](https://stellar.expert/explorer/testnet/contract/CCZMEGP4UDCQYQORCF6225SOMLLSUTC3OCPLNECLBOGFADM3AZZQ5EMF)
- WASM SHA-256: `b5347660a7ff9d2bb991c086d37921ff79c5ec9adfcbfa9315b63970dfc1f5be`
- Artifact: `target/wasm32v1-none/release/naru_split.wasm`
- RPC: `https://soroban-testnet.stellar.org`
- Network passphrase: `Test SDF Network ; September 2015`
- Full public evidence, account addresses, and transaction hashes:
  [`deployments/testnet.json`](deployments/testnet.json).

All transactions below were independently checked with RPC `getTransaction`:

| Action | Ledger | Transaction |
| --- | ---: | --- |
| Upload WASM | 5028251 | [486f31512818…](https://stellar.expert/explorer/testnet/tx/486f3151281844d49d5ab5768b3e7b988150d459a56134445f0ba3b7efd8887e) |
| Deploy instance | 5028254 | [3ffcb954f59d…](https://stellar.expert/explorer/testnet/tx/3ffcb954f59d7c289c320ea2ed0115f63a0acc2823f045707c834ae924941549) |
| Obtain 1 official Testnet USDC for Alice | 5028258 | [20d86913c76f…](https://stellar.expert/explorer/testnet/tx/20d86913c76f4c16504c7be0e33f7c172a279febe7db77a08ab55d6894057e61) |
| Create | 5028263 | [3676b1ecbe77…](https://stellar.expert/explorer/testnet/tx/3676b1ecbe77e86525d7de6a40e2a73c6f3e2aa9ea2e0194d9d2f335c8da0961) |
| Alice pays | 5028267 | [e072e165fd38…](https://stellar.expert/explorer/testnet/tx/e072e165fd385adbbaf8d8cb09eaee66ab95286b6d9214fb879430d92e2b2c87) |
| Organizer cancels Bob's unpaid share | 5028268 | [809670bfe4e7…](https://stellar.expert/explorer/testnet/tx/809670bfe4e78e25aa3f279f65ae7a6d42ed1e07a3215ad89fd80ca60eeb3107) |
| Identical creation retry, reordered participants | 5028275 | [90bff4807bb6…](https://stellar.expert/explorer/testnet/tx/90bff4807bb65f49cf3de2d478ebe634370cb619ecce812ae8eb6bd522c156c1) |

The split total was **3,000,001 units = 0.3000001 USDC**. The organizer's share
was 1,000,001 units with state `Organizer`; Alice's 1,000,000 units became
`Paid(5028267)`; Bob's 1,000,000 units became `Cancelled(5028268)`.

Alice's USDC balance changed from **1 to 0.9**, the organizer's from **0 to 0.1**,
and the contract's remained **0**. The identical creation retry returned `false`
and preserved the original creation ledger and terminal states. Subsequent
duplicate-payment and payment-after-cancellation **simulations** failed with
NaruSplit errors `9` and `10`; these simulations were not submitted transactions.

### Verify this deployment

From the repository root, with workspace JS dependencies installed (`pnpm install`):

```sh
stellar contract build --package naru-split
node contracts/naru-split/scripts/verify-testnet.mjs
```

The read-only verifier checks local WASM hash against the deployed instance,
network, official asset derivation and precision, all nine recorded transaction
receipts (including two trustlines), the exact payment authorization tree,
current split state, and balances. It uses the existing installed Stellar JS SDK
and public addresses; it neither signs nor submits transactions.

RPC transaction history has finite retention. A later `NOT_FOUND`, archived
instance, Testnet reset, or changed test-account balance is reported as a failed
verification, not silently counted as a successful rerun. The JSON evidence is
the dated record of this run.

## Rules and public interface

Amounts are positive `i128` integer token units. **1 USDC = 10,000,000 units.**
There are 2–13 unique participant addresses, including the organizer exactly
once. The total must be at least the participant count, so every share is positive.

Addresses are sorted by Soroban's native `Address` ordering, **not** their display
strings or supplied order. For `n` participants, each gets `total / n`; the first
`total % n` addresses each get one additional unit. This conserves the total up
to `i128::MAX` without floating point. The organizer's share is included in that
calculation but is never payable or cancellable.

The verified official Testnet USDC SAC is compiled into the contract:

```text
Asset:    USDC
Issuer:   GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
Contract: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Decimals: 7
```

Identity matches `backend/convex/money.ts`, official Stellar documentation, the
Testnet asset-derived contract ID, and the live SAC's `decimals` response.

Signatures below omit the injected `Env`. `Result` errors abort the invocation.

| Method | Result | Authorization / behavior |
| --- | --- | --- |
| `create(organizer: Address, split_id: BytesN<32>, total: i128, participants: Vec<Address>)` | `Result<bool, Error>` | Organizer signs all arguments. Recipient is fixed to that organizer; equal shares are derived deterministically. `true` for a new split; `false` for identical immutable terms under the same ID. |
| `pay(organizer: Address, split_id: BytesN<32>, participant: Address)` | `Result<(), Error>` | Participant signs this exact request and the nested token transfer. Transfers only their exact outstanding share. |
| `cancel(organizer: Address, split_id: BytesN<32>, participant: Address)` | `Result<(), Error>` | Organizer signs cancellation of this one outstanding share. |
| `get(organizer: Address, split_id: BytesN<32>)` | `Option<Split>` | Public bounded state; `None` only for a never-created ID. Successful submitted access can extend TTL. |
| `usdc()` | `Address` | Returns the pinned SAC. |
| `keep_alive(organizer: Address, split_id: BytesN<32>)` | `Result<(), Error>` | Permissionless TTL maintenance for an existing split, including terminal records. |

A split is keyed by **`(organizer, split_id)`**. Callers retain a random opaque
32-byte ID for retries; another organizer has an independent namespace. Identical
terms with reordered participants are the same request. Different valid terms
under an existing key fail; a retry after payment/cancellation cannot reset state.
A new ID is a new request, even if its terms happen to match another split.

```text
Split {
  recipient: Address,              // always the organizer in the key
  total: i128,
  shares: Vec<Share>,               // canonical address order, at most 13
  created_ledger: u32
}
Share { participant: Address, amount: i128, state: ShareState }
ShareState = Organizer | Outstanding | Paid(u32) | Cancelled(u32)
```

Only `Outstanding → Paid(ledger)` or `Outstanding → Cancelled(ledger)` is
allowed. Paid and cancelled records are terminal. Cancellation neither refunds
nor redistributes a share. Names, descriptions, application IDs, and conversations
stay off-chain; the opaque ID must not encode personal text. This interface has
no escrow, pooled balances, partial payments, automatic charges, debt netting,
token selection, administrator, withdrawal, or upgrade entry point.

### Authorization and atomicity

All identity checks use native `Address.require_auth()`, accepting native and
contract-account addresses without another wallet/signature implementation.
The required payment tree is:

```text
participant authorizes:
  NaruSplit.pay(organizer, split_id, participant)
    └─ official_USDC.transfer(participant, organizer, stored_share_amount)
```

Creation authorizes only creation. Organizer authorization cannot pay another
person's share. A payment's root-only authorization or bare token authorization
is insufficient. No token allowance or `transfer_from` is used.

Settlement is written and the exact transfer is invoked in one atomic contract
invocation. A token failure propagates, reverting settlement, token changes, TTL
updates, and events. Soroban serializes conflicting updates to the same split;
payment/cancellation ordering is resolved on-chain rather than by off-chain checks.

### Typed lifecycle events

`#[contractevent]` embeds these definitions in the public WASM specification:

| Event | Topics | Data |
| --- | --- | --- |
| `SplitCreated` | `split_created`, organizer, split ID | `{ split: Split }` |
| `SharePaid` | `share_paid`, organizer, split ID, participant | `{ amount: i128, ledger: u32 }` |
| `ShareCancelled` | `share_cancelled`, organizer, split ID, participant | `{ amount: i128, ledger: u32 }` |

Identical creation retries and failed invocations emit no lifecycle event.
Terminal states and their ledger numbers remain queryable independently of RPC
event retention. A future indexer can join events with their transaction hashes.

### Errors

| Code | Name | Meaning |
| ---: | --- | --- |
| 1 | `InvalidCount` | Fewer than 2 or more than 13 participants |
| 2 | `DuplicateParticipant` | Repeated address |
| 3 | `MissingOrganizer` | Organizer not in participants |
| 4 | `InvalidAmount` | Total below participant count, including zero/negative |
| 5 | `ConflictingSplit` | Existing ID with different valid immutable terms |
| 6 | `NotFound` | Unknown organizer-scoped ID |
| 7 | `NotParticipant` | Address has no share in this split |
| 8 | `OrganizerShare` | Attempt to pay/cancel the organizer's included share |
| 9 | `AlreadyPaid` | Attempt to pay/cancel a paid share |
| 10 | `Cancelled` | Attempt to pay/cancel a cancelled share |

Host authorization errors and downstream USDC errors propagate with their own
origin; they are not remapped to successful settlements.

## Persistent storage, TTL, and restoration

Each `DataKey::Split(organizer, split_id)` is a **single persistent entry** holding
the immutable terms, all share states, and creation-idempotency record. It is
never deleted, including when every request is terminal. No settlement or
duplicate-prevention data uses temporary or instance storage.

Create, successful create retries, pay, cancel, successful `get`, and `keep_alive`
explicitly extend that persistent entry and the contract instance/WASM. The
threshold is **518,400 ledgers** and the target **2,073,600 ledgers** (approximately
30 and 120 days at five seconds per ledger), clamped to the network maximum TTL.
Submitted keep-alive calls near the threshold can renew terminal records too.

Simulation-only reads (`--send=no`) do **not** persist a TTL extension. Anyone may
submit `keep_alive`; no user payment authorization is needed for maintenance.
For example, after setting the shell variables below:

```sh
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  --send=yes -- keep_alive --organizer "$ORG" --split_id "$SPLIT_ID"
```

Archived persistent entries remain the same entries. Modern RPC/CLI simulation
and restoration must restore the original contract/WASM and split key before
execution. An unrestored archived entry cannot be treated as a fresh `None` by
the on-chain host. There is no expiry-driven reset path and no restoration-time
initializer. Use the normal restoration flow, then retry with the **same** ID;
never create a replacement record to work around archival. TTL is not a consent
deadline. Testnet network resets are distinct from archival and destroy the test
network's state.

## Tests and validation boundaries

```sh
cargo fmt --manifest-path contracts/naru-split/Cargo.toml --check
cargo test -p naru-split --locked
cargo clippy -p naru-split --all-targets --locked -- -D warnings
stellar contract build --package naru-split
```

All **11 tests** pass. They cover all participant counts 2–13, totals through
`i128::MAX`, canonical rounding and reordered retries; invalid counts,
duplicates, missing organizers and bad amounts; missing/wrong signer and changed
creation/cancellation arguments; absent, incomplete, or altered payment auth
trees; ID conflicts and organizer namespaces; duplicate payments, both
cancellation/payment orderings and self-payment rejection; insufficient USDC and
a revoked recipient; failed-transfer rollback and successful subsequent retries;
typed events; and TTL extension plus archival/restoration of terminal records.

Tests instantiate the host's actual SAC for the official Testnet asset in an
in-memory Testnet ledger. Only fixture minting/revocation uses blanket auth;
NaruSplit actions use narrowly specified `MockAuth` trees and missing/incorrect
authorization tests. No replacement token is deployed to Testnet.

**What was actually validated:** native Rust contract tests, release WASM build,
live CLI deployment, classic-account create/pay/cancel/retry, RPC-confirmed
receipts, actual token balances, and the signed transaction's two-node auth tree.
Archival/restoration was **SDK-emulated**, not a live 120-day archival cycle.

**Smart accounts:** the live payment used `sorobanCredentialsSourceAccount` and
classic Ed25519 test accounts. No Naru smart-account `__check_auth`, WebAuthn,
passkey, or sponsored application flow was executed for this contract. Native
`Address` auth provides the integration surface; the unit-test mock C-addresses
are not evidence of passkey validation. The existing adapter's swap path shows
how two auth contexts use `contextRuleIds: [0, 0]`; a future NaruSplit payment
integration must review the root plus exact USDC child and use the existing
account policy/signing machinery for both contexts. No deployment or CLI smoke
blocker remained at completion.

## Reproduce deployment and smoke test

Run from the repository root in Bash or Zsh. These commands use new CLI test
identities stored outside the repository and Friendbot-funded XLM.

### 1. Build, create identities, verify the asset, and deploy

```sh
cargo test -p naru-split --locked
stellar contract build --package naru-split

CFG="$HOME/.config/stellar-naru-split"
mkdir -p "$CFG"
st() { stellar --config-dir "$CFG" "$@"; }
RUN=$(date -u +%Y%m%dT%H%M%SZ)
ORG_KEY="naru-split-organizer-$RUN"
ALICE_KEY="naru-split-alice-$RUN"
BOB_KEY="naru-split-bob-$RUN"
st keys generate "$ORG_KEY" --network testnet --fund
st keys generate "$ALICE_KEY" --network testnet --fund
st keys generate "$BOB_KEY" --network testnet --fund
ORG=$(st keys address "$ORG_KEY")
ALICE=$(st keys address "$ALICE_KEY")
BOB=$(st keys address "$BOB_KEY")

ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
USDC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
test "$(st contract id asset --network testnet --asset "USDC:$ISSUER")" = "$USDC"
st contract invoke --network testnet --source "$ORG_KEY" --id "$USDC" \
  --send=no -- decimals

WASM=target/wasm32v1-none/release/naru_split.wasm
WASM_HASH=$(st contract upload --network testnet --source "$ORG_KEY" --wasm "$WASM")
CONTRACT=$(st contract deploy --network testnet --source "$ORG_KEY" --wasm-hash "$WASM_HASH")
```

Record the hash, contract ID, and transaction hashes printed by the CLI. Keys
remain local; the deployment evidence contains only public values.

### 2. Fund Alice with the existing official-USDC market

The recorded run used the same Soroswap router already pinned by Naru, spending
**9.4585800 Friendbot XLM** for **1 official Testnet USDC**. The following retains
the actual run's hard cap of **10 XLM**. Read the current quote first; the swap
fails if that cap is insufficient or the Testnet deployment/market has changed.

```sh
st tx new change-trust --network testnet --source "$ORG_KEY" --line "USDC:$ISSUER"
st tx new change-trust --network testnet --source "$ALICE_KEY" --line "USDC:$ISSUER"

ROUTER=CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD
TOKEN_PATH='["CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC","CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"]'
st contract invoke --network testnet --source "$ALICE_KEY" --id "$ROUTER" \
  --send=no -- router_get_amounts_in --amount_out 10000000 --path "$TOKEN_PATH"
st contract invoke --network testnet --source "$ALICE_KEY" --id "$ROUTER" \
  -- swap_tokens_for_exact_tokens --amount_out 10000000 --amount_in_max 100000000 \
  --path "$TOKEN_PATH" --to "$ALICE" --deadline "$(( $(date +%s) + 300 ))"

st contract invoke --network testnet --source "$ALICE_KEY" --id "$USDC" \
  --send=no -- balance --id "$ALICE"
```

### 3. Create → pay → cancel another unpaid share

```sh
SPLIT_ID=0000000000000000000000000000000000000000000000000000000000000001
PARTICIPANTS="[\"$BOB\",\"$ORG\",\"$ALICE\"]"
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  -- create --organizer "$ORG" --split_id "$SPLIT_ID" --total 3000001 \
  --participants "$PARTICIPANTS"
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  --send=no -- get --organizer "$ORG" --split_id "$SPLIT_ID"

st contract invoke --network testnet --source "$ALICE_KEY" --id "$CONTRACT" \
  -- pay --organizer "$ORG" --split_id "$SPLIT_ID" --participant "$ALICE"
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  -- cancel --organizer "$ORG" --split_id "$SPLIT_ID" --participant "$BOB"

# Same ID and immutable terms: returns false, preserving paid/cancelled states.
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  -- create --organizer "$ORG" --split_id "$SPLIT_ID" --total 3000001 \
  --participants "[\"$ORG\",\"$ALICE\",\"$BOB\"]"
st contract invoke --network testnet --source "$ORG_KEY" --id "$CONTRACT" \
  --send=no -- get --organizer "$ORG" --split_id "$SPLIT_ID"
st contract invoke --network testnet --source "$ORG_KEY" --id "$USDC" \
  --send=no -- balance --id "$ORG"
st contract invoke --network testnet --source "$ALICE_KEY" --id "$USDC" \
  --send=no -- balance --id "$ALICE"
st contract invoke --network testnet --source "$ORG_KEY" --id "$USDC" \
  --send=no -- balance --id "$CONTRACT"
```

Fresh addresses may allocate the extra unit to a different participant. Review
the returned shares: the paid amount must match Alice's stored share exactly,
Bob must be cancelled, the organizer must remain `Organizer`, and the contract
must retain no funds from the payment.

These two checks must exit nonzero with `AlreadyPaid` (`#9`) and `Cancelled`
(`#10`) respectively; run them individually:

```sh
st contract invoke --network testnet --source "$ALICE_KEY" --id "$CONTRACT" \
  --send=no -- pay --organizer "$ORG" --split_id "$SPLIT_ID" --participant "$ALICE"
st contract invoke --network testnet --source "$BOB_KEY" --id "$CONTRACT" \
  --send=no -- pay --organizer "$ORG" --split_id "$SPLIT_ID" --participant "$BOB"
```

The checked-in verifier targets the **recorded deployment**, not new test runs.
For a new run, retain its own public IDs, hashes, ledgers, balances and auth tree;
query each submitted hash with RPC `getTransaction` until `SUCCESS` or `FAILED`.

## Sources and repository context reviewed

Current official references consulted on 2026-10-05 UTC:

- [Official Testnet USDC identity](https://developers.stellar.org/docs/build/agentic-payments/x402#testnet-usdc).
- [Native contract authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
  and [authorization testing](https://developers.stellar.org/docs/build/guides/auth/contract-authorization).
- [Storage strategies and explicit TTL extension](https://developers.stellar.org/docs/build/guides/storage/storage-strategies)
  and [TTL testing](https://developers.stellar.org/docs/build/guides/archival/test-ttl-extension).
- [Typed event publication](https://developers.stellar.org/docs/build/guides/events/publish).
- Raven prior-art discovery: [`stellar/soroban-examples`](https://github.com/stellar/soroban-examples),
  official example patterns for auth/storage/testing; Scout reported last commit
  2026-09-24. This is a pattern reference, not evidence of a ready-made split
  implementation, audit, deployment, or smart-account compatibility. NaruSplit
  adds no dependency on that repository.

Repository inspection covered `backend/convex/splits.ts` and `money.ts` (integer
shares and self-share exclusion), `app/src/lib/smart-account/adapter.ts` and
`server/policy.ts` (native authorization and existing two-context signing), and
`app/src/lib/swaps/shared.ts` (verified Testnet identities). All implementation,
tests, deployment evidence, and verification tooling live in this contract folder;
the workspace lockfile only gains the `naru-split` package.
