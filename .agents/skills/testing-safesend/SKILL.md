---
name: testing-safesend
description: How to run and test the SafeSend demo dapp end-to-end on local Anvil — demo accounts, lookalike impersonation, evm time travel, and UI quirks
---

# Testing the SafeSend demo (poison-aware payment router)

## Bring the stack up
From the repo root (Makefile does everything):
- `make anvil` — local chain, id 31337, port 8545
- `make deploy-local` — deploys SafeSend + MockUSDT + Poisoner; Deploy.s.sol rewrites `web/src/deployments/31337.json`
- `make seed` — mints mUSDT, seeds a verified payee + escrows
- `make web` — vite dev server at `http://localhost:5173/?demo=1`

For a fresh quarantine demo, restart the local Anvil process before deploying
and seeding; a previously claimed lookalike is already verified and will route
instantly. Restarting resets all local-only chain state. The seed leaves the
victim with 49,900 mUSDT after Terry claims 100 mUSDT.

## Demo wallet mode
Append `?demo=1`. The header `<select>` switches the acting identity between
Victim / Terry / Friend / Attacker (Anvil dev keys 0–3, see `web/src/lib/demo.ts`)
and Lookalike recipient (impersonated).
`me` = the selected demo account — no MetaMask needed. A card's buttons depend on
the selected account: `Cancel & refund` / `Approve escrow #…` are
sender-only; `Claim` is recipient-only.

## Toolchain paths
`cast`, `forge`, `anvil` live in `~/.foundry/bin` — prepend to PATH; they are not
on the default PATH.

## Acting as a lookalike / keyless address
Use the fifth picker entry, `Lookalike recipient (impersonated)`, for browser
claim tests against the deterministic `DEMO_LOOKALIKE`. It uses the same
Pending UI as other accounts, with writes routed through Anvil impersonation.
Generating a different lookalike in the Attacker console does not change this
fixed picker identity.

Lookalike addresses have no private key. For supplementary CLI checks:
`cast rpc anvil_impersonateAccount <addr>` + `cast rpc anvil_setBalance <addr> 0xde0b6b3a7640000`,
then `cast send --unlocked --from <addr> ...`, then `anvil_stopImpersonatingAccount`.
Important: without impersonation, `cast send --unlocked` still surfaces
gas-estimation reverts (so a failing call looks identical) but a *successful*
call fails at signing with "No Signer available" — always impersonate first.

## Time travel
`cast rpc --rpc-url http://127.0.0.1:8545 evm_increaseTime <secs>` + `evm_mine`.
The seed script can advance the chain clock well ahead of wall time. Pending
uses the latest chain block timestamp as a lower bound for its unlock display
and button state. The contract remains authoritative for claim eligibility:
check `block.timestamp` against `unlockAt` if the display looks stale.
Allow one polling interval (about 4 seconds) after mining or a transaction;
the flow should not require a manual reload. The unapproved recipient's Claim
must remain disabled even when the card says `unlocked`.

## Evidence and negative checks
- Record pre-send, pre-refund and post-refund balances; dust adds 0.000042
  mUSDT, so compare exact decimals rather than rounded amounts.
- Verify both the on-chain `verified(sender, recipient)` value and the next
  Send badge after a claim; an instant send must leave `nextId()` unchanged.
- Disabled Claim proves the UI gate, not the displayed contract-revert path.
  Use an impersonated CLI call for `NotApproved`/`NotSender` checks and label
  that evidence contract-only rather than claiming the UI showed the errors.
- Full addresses may only be available by hovering truncated payee entries.
  Capture the tooltip when distinguishing two entries with one fingerprint.

## Escrow/claim semantics worth knowing
- `claim()` revert order: NotRecipient → NotPending → `Locked` (before
  unlockAt) → `NotApproved` (LookalikeOfVerified && !lookalikeApproved). To
  exercise the approval gate you must time-travel past `unlockAt` first,
  otherwise you only ever see `Locked`.
- A claimed lookalike becomes a *verified* payee for that sender — further
  sends to it go instant with no escrow. To re-demo the quarantine flag,
  generate a new lookalike (any address sharing the verified payee's first/last
  4 hex; randomize the 32 middle chars — e.g. `0x7099<32 hex>79c8` collides
  with seeded payee Terry 0x7099…79C8).
- `approveLookalike(id)` is sender-only, Pending-only, lookalike-only — reverts
  NotSender/NotPending/NotLookalike respectively.
- Contract addresses come from `web/src/deployments/31337.json`
  (`safeSend`, `mockUSDT`, `poisoner`).

## Devin Secrets Needed
None — everything runs locally on Anvil dev accounts.
