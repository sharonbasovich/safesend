# Devpost submission copy — SafeSend

Headings mirror the required Devpost fields verbatim. Fill the links after
publishing the repo / uploading the video.

## Problem statement

Address poisoning is one of the cheapest attacks in crypto and one of the
most expensive for victims. Attackers generate "lookalike" addresses that
share the first and last four characters of a victim's real payee — the only
characters most wallets display — then inject the fake into the victim's
transaction history using zero-value `transferFrom` calls (which succeed on
USDT-style ERC-20s with no allowance) or small dust transfers. When the
victim later copies a "recent counterparty" from their history and hits send,
the funds are gone permanently. Individual thefts documented publicly reach
tens of millions of dollars, and the campaigns run continuously because each
attack costs the attacker almost nothing.

## Solution

SafeSend is a payment router that makes poisoned sends cancellable. Instead
of transferring directly, a user sends through the SafeSend contract, which
computes a fingerprint of the recipient — the same first/last-4-hex
characters the wallet displays:

- **Verified payee** → transfers instantly, no escrow.
- **Unknown payee** → enters a sender-cancellable escrow; only the intended
  recipient can claim after the unlock window, and claiming verifies them
  for all future sends.
- **Lookalike** — any address whose fingerprint collides with a verified
  payee → lands in a 24-hour quarantine and emits an on-chain
  `LookalikeFlagged` event. The sender can cancel for a full refund at any
  time; the flagged recipient cannot claim at all without the sender's
  explicit on-chain approval (`approveLookalike`), and the sender can still
  cancel even after approving. Approving is a deliberate trust decision:
  an approved claim pays out *and verifies* that address for future instant
  sends — which is exactly why it can never happen automatically.

The defense is at the same layer the attack exploits: the contract compares
exactly the characters wallets display, and it enforces on-chain so it works
even if a UI is lying or compromised.

## Prototype/MVP

Working end-to-end on local Anvil (chain 31337) and deployable to Base
Sepolia:

- `contracts/src/SafeSend.sol` — the router (verified/unknown/lookalike
  routing, escrow, cancel/claim/reclaim, sender-gated `approveLookalike` for
  flagged escrows, on-chain per-sender payee book and cooldowns). No owner,
  no admin keys, no fees, no upgradeability;
  OpenZeppelin `SafeERC20` + `ReentrancyGuard`, checks-effects-interactions.
- `contracts/src/demo/Poisoner.sol` — a self-contained reproduction of the
  real attack (zero-value `transferFrom` insertion + dust), Anvil-only.
- `web/` — React + TypeScript + wagmi + viem + Tailwind app: Send (with live
  risk badge), Pending & quarantine, Payees, History (poison detection), and
  an Attacker console that runs the whole attack so judges can watch it
  happen.
- The guided demo shows: attacker poisons the victim's history → victim
  sends to the lookalike → quarantine + flag (claimable only with the
  sender's approval — the lookalike can never self-release) → victim cancels
  and is refunded → victim sends to the real verified payee instantly → a
  new contact escrows, claims, and becomes verified.

## Tech stack

- **Contracts:** Solidity 0.8.28, Foundry (forge/anvil/cast), OpenZeppelin
  Contracts (SafeERC20, ReentrancyGuard)
- **Testing:** Forge unit/negative/fuzz (512 runs) + invariant suite
  (128 runs × depth 32); 57 tests, 100% line coverage on SafeSend.sol
- **Web:** Vite, React 18, TypeScript, wagmi v2 + viem v2, Tailwind CSS,
  TanStack Query
- **Demo tooling:** Anvil (local chain), viem scripts for deploy + seed,
  `anvil_impersonateAccount` for attack reproduction (Anvil-only)
- **Chains:** Anvil 31337 (primary demo), Base Sepolia 84532 (optional
  testnet deploy)

## GitHub

https://github.com/sharonbasovich/safesend

## Demo

- Video: https://github.com/sharonbasovich/safesend/blob/main/docs/safesend-demo-anvil-e2e.mp4
  (real local-Anvil end-to-end walkthrough; upload to a Devpost-supported video
  host if required)
- Web showcase: https://sharonbasovich.github.io/safesend/ — video, deck, and
  screenshots. It is not a live public-chain demo; the interactive web UI
  requires a local Anvil node as described below.
- Local demo: `make anvil && make deploy-local && make seed && make web`,
  then open `http://localhost:5173/?demo=1`
- Screenshots: `docs/screenshots/` (attack → quarantine → refund → verified
  payees)

## Presentation

- Slide deck: `docs/deck.pdf` (8 slides)
- Video script: `docs/video-script.md`
- README: setup, guided demo steps, security model, limitations, prior art

## Disclosures

- **Unaudited testnet prototype.** Not audited, not mainnet-ready, do not
  use with real funds.
- **Does not prevent every loss.** It protects sends routed through
  SafeSend; raw transfers and 6+-character lookalike collisions are out of
  scope. Verification via `addPayee` is only as good as the sender's
  out-of-band check.
- **Attack tooling is educational** and confined to local Anvil/test assets.
- **Prior art disclosed:** REVERSO / ERC-20R/721R, Argent trusted contacts,
  explorer name-tags. SafeSend's contribution is deterministic, on-chain,
  fingerprint-based quarantine with a self-growing payee book — no
  arbitration, no oracle, no trusted party.
