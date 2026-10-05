# NaruSplit

**Equal USDC reimbursements between friends, authorized with passkeys on Stellar.**
An organizer publishes a shared expense; each friend receives their request in
Naru's existing DM. Publishing records the terms—it never moves anyone's funds.

## See it working

In Naru, add two friends with activated accounts and ask:
**“I paid 12 USDC; split it between @ana, @josh, and me.”** Review the three
4-USDC shares and choose **Publish requests with passkey**. Each friend receives
one read-only request card. Payment and cancellation exist in the contract;
their app integration is still pending.

**Verified on Testnet, October 5, 2026:** the three-person flow published
successfully, delivered both requests, and recovered an interrupted response
without duplicating them. The actual network fee was **0.1846935 XLM**, paid by
Naru's sponsor. Verification used Chromium virtual passkeys with real on-chain
authorization.

- [Live contract · v0.2.0](https://stellar.expert/explorer/testnet/contract/CCGF3HL4GCL37O2ZCCU6ZJRU5EEUGFRMZEV46BHKF5767ZYPY4BM6R76)
- [Confirmed publication](https://stellar.expert/explorer/testnet/tx/65bc68f184aea68be781a3bc1aad8e6137e140bd6d3c64d0bc3999a6c1e18a93)
- [Deployment, fees, and receipt data](deployments/testnet.json)
- [Contract source](src/lib.rs) · [Focused tests](src/test.rs)

## Contract at a glance

| Method       | What it does                                                           | Who authorizes                                      |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `create`     | Records immutable terms; identical retries preserve the original state | Organizer                                           |
| `pay`        | Transfers one outstanding share directly to the organizer              | That participant, including the exact USDC transfer |
| `cancel`     | Cancels one outstanding share                                          | Organizer                                           |
| `get`        | Reads terms and share states without renewing storage                  | Public                                              |
| `usdc`       | Returns the pinned official Testnet USDC contract                      | Public                                              |
| `keep_alive` | Renews the selected split's persistent storage                         | Permissionless                                      |

- **2–13 participants**, including the organizer, whose share requires no self-payment.
- Integer amounts with **7 decimals**. Equal division and deterministic rounding
  in native address order conserve every unit.
- **Noncustodial:** payment goes directly from participant to organizer. Transfer
  failure rolls back settlement; paid/cancelled shares cannot be charged again.
- Each split is keyed by `(organizer, split_id)`. Retries cannot change terms or
  reset settlement. Names, descriptions, and conversations stay off-chain.

## Fees and persistence

Compact storage keeps creation below the **0.5 XLM sponsor cap**: all twelve
participant counts were independently passkey-signed and simulated with RPC
`enforce`, estimating **0.2012374–0.3327675 XLM**. These are dated estimates;
the app simulates each transaction again before submission.

Split records have a **30-day TTL**, renewed below **7 days**. Archival preserves
the original terms and terminal states; restoration uses the same key. Shared
WASM/instance upkeep is paid separately by an operator: the recorded upload,
deployment, and 30-day renewal charged **4.8968772**, **0.0061579**, and
**16.0682246 XLM**, respectively.

## Verify locally

From the repository root, with dependencies and the pinned Rust toolchain installed:

```sh
pnpm --dir contracts test
pnpm --dir contracts build
node contracts/naru-split/scripts/verify-testnet.mjs
```

The **13 contract tests** cover rounding, authorization, replay prevention,
settlement rollback, and storage lifetime. The read-only verifier checks the
built WASM against the deployed code, recorded receipts, creation authorization,
fees, and split state. It needs live Testnet state and retained RPC receipts;
archival/reset or expired receipt history is reported as a verification failure.
Restoration tests are SDK-emulated, not a completed live 30-day archival cycle.

<details>
<summary>Operator maintenance</summary>

Schedule these daily; no scheduler is installed by this repository. Both default
to inspection/simulation. Add `--apply` to submit within the configured budget.

```sh
pnpm --dir app splits:maintain
node contracts/naru-split/scripts/operator-testnet.mjs --maintain
```

Split maintenance uses the app's server environment and existing sponsor journal,
with the same 0.5 XLM cap. The infrastructure operator needs Stellar CLI and:

- `NARU_SPLIT_OPERATOR_CONFIG`: CLI configuration directory.
- `NARU_SPLIT_OPERATOR_IDENTITY`: separate funded Testnet identity.
- `NARU_SPLIT_OPERATOR_JOURNAL`: durable private journal from deployment; reuse it.
- `NARU_SPLIT_OPERATOR_OUTPUT`: public operator receipt output, outside this repo.
- `NARU_SPLIT_OPERATOR_BUDGET_STROOPS`: explicit per-transaction operator budget.
- `NARU_SMART_ACCOUNT_SPONSOR_ADDRESS`: sponsor public address to enforce separation.

Omit `--maintain` to deploy a new build with a new journal. Review the resulting
deployment before updating the app's pinned contract; the contract has no upgrade
entry point.

</details>
