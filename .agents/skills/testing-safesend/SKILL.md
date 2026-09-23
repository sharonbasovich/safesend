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

## Demo wallet mode
Append `?demo=1`. The header `<select>` switches the acting identity between
Victim / Terry / Friend / Attacker (Anvil dev keys 0–3, see `web/src/lib/demo.ts`).
`me` = the selected demo account — no MetaMask needed. A card's buttons depend on
the selected account: `Cancel & refund` / `Approve this flagged recipient` are
sender-only; `Claim` is recipient-only.

## Toolchain paths
`cast`, `forge`, `anvil` live in `~/.foundry/bin` — prepend to PATH; they are not
on the default PATH.

## Acting as a lookalike / keyless address
Lookalike addresses have no private key. To send from one:
`cast rpc anvil_impersonateAccount <addr>` + `cast rpc anvil_setBalance <addr> 0xde0b6b3a7640000`,
then `cast send --unlocked --from <addr> ...`, then `anvil_stopImpersonatingAccount`.
Important: without impersonation, `cast send --unlocked` still surfaces
gas-estimation reverts (so a failing call looks identical) but a *successful*
call fails at signing with "No Signer available" — always impersonate first.

## Time travel
`cast rpc --rpc-url http://127.0.0.1:8545 evm_increaseTime <secs>` + `evm_mine`.
The seed script already advances the chain clock well ahead of wall time, and
Pending.tsx's countdown compares chain `unlockAt` to wall-clock `Date.now()` —
so displayed countdowns can show ~72–96h even when the on-chain lock has
expired. Judge lock state on-chain (`block.timestamp` vs `unlockAt`), not by
the rendered countdown.

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
