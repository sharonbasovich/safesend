# SafeSend — poison-aware EVM payment router

**3rd Web Hack entry. Unaudited testnet prototype — do not use with real funds.**

[Public demo showcase](https://sharonbasovich.github.io/safesend/) · [Local-Anvil demo video](docs/safesend-demo-anvil-e2e.mp4) · [Eight-slide deck](docs/deck.pdf) · [Demo screenshots](docs/screenshots/)

SafeSend is a non-custodial payment router that protects senders from
address-poisoning attacks. Instead of giving your money directly to an address
you pasted from transaction history (the single most common way people lose
funds to poisoning), you send through SafeSend:

- **Verified payee** → funds move instantly, no escrow.
- **Unknown payee** → funds sit in a sender-cancellable escrow until the
  recipient claims.
- **Lookalike payee** — same first/last 4 hex chars as one of your verified
  payees → funds land in a **24-hour quarantine**, an on-chain
  `LookalikeFlagged` event fires, and you can cancel at any time.

When the intended recipient claims after the unlock window, SafeSend records
them as a *verified payee* for your future sends — the payee book grows
organically out of successful deliveries.

## How it works

SafeSend computes a **fingerprint** for every recipient:

```
fingerprint(a) = (first 4 hex chars of a) << 16 | (last 4 hex chars of a)
```

Two different addresses can share a fingerprint — that is exactly how
address-poisoning lookalikes work. `fpCount[from][fp]` tracks how many of the
sender's verified payees carry each fingerprint, so `send()` can distinguish:

| `to` is …                                | Result                                            |
|------------------------------------------|---------------------------------------------------|
| Verified payee                           | instant transfer, `Sent` event                     |
| Fingerprint-collides with a verified one | escrow, `unlockAt = now + 24h`, `LookalikeFlagged` |
| Otherwise                                | escrow, `unlockAt = now + sender cooldown`         |

- `cancel(id)` — sender only, any time while `Pending`. Full refund.
- `claim(id)` — recipient only, after `unlockAt`. Pays out **and verifies** the
  recipient (`PayeeVerified`).
- `reclaim(id)` — sender only, after `unlockAt + 30 days`. Dead-letter
  recovery for recipients that never claim.
- `addPayee` / `removePayee` — the sender's own verified book, on-chain.
- `setCooldown` — per-sender escrow window for unknown payees
  (60 s – 7 days, default 1 h).

The contract has **no owner, no admin keys, no fees, no upgradeability, and no
external contract dependencies** besides the OpenZeppelin library. Senders and
recipients are the only actors.

## The attack it defends against

Real address-poisoning campaigns (hundreds of millions lost, e.g. the
$68M WBTC incident) exploit the fact that wallets and users only check the
first and last few characters of an address. The attacker:

1. Generates a lookalike that matches a real payee's first/last 4 hex.
2. Injects a **zero-value `transferFrom`** — on USDT-style ERC-20s this
   succeeds with zero allowance — so the lookalike appears in the victim's
   *outgoing* history.
3. Optionally sends a small **dust transfer** so it also appears in
   *incoming* history.
4. Waits for the victim to copy the lookalike out of their history and send.

SafeSend catches step 4: the lookalike's fingerprint collides with a verified
payee, so the send is quarantined instead of irreversible. The repo includes a
self-contained reproduction — `contracts/src/demo/Poisoner.sol` and the
**Attacker console** page — that performs steps 1–3 against the demo
environment so you can watch it happen.

## Repo layout

```
contracts/        Foundry project
  src/SafeSend.sol        the router
  src/MockUSDT.sol        6-decimal test token (public mint — demo only)
  src/demo/Poisoner.sol   attack reproduction (Anvil only)
  script/Deploy.s.sol     deploys all three, writes web/src/deployments/<chain>.json
  test/                   unit, negative, fuzz, invariant, Poisoner tests
web/              Vite + React 18 + TypeScript + wagmi v2 + Tailwind UI
  src/pages/      Send, Pending, Payees, History, Attacker console
scripts/          seed-demo.ts — seeds the demo scenario on local Anvil
docs/             screenshots, video script, slide deck, Devpost copy
Makefile          one-command demo targets
```

## Quick start — local demo (≈2 min)

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation)
(`anvil`, `forge`, `cast`), Node 20+.

```bash
# 1. contracts deps + tests
cd contracts && forge install && forge test -vvv && cd ..

# 2. terminal A — local chain
make anvil

# 3. terminal B — deploy + seed the demo scenario
make deploy-local
make seed

# 4. web UI
make web          # → http://localhost:5173/?demo=1
```

Open `http://localhost:5173/?demo=1`. The demo mode lets you drive four Anvil
accounts (Victim / Terry / New friend / Attacker) from the account picker —
no MetaMask needed locally. With a browser wallet connected on Base Sepolia,
the same UI uses wagmi instead.

### The guided demo (~3 min)

1. **Attacker console** — pick Terry as the target, click
   *"1. Poison history"* then *"2. Dust victim"*. Check the **History** tab:
   the lookalike `0x7099…79c8` now shows up in the victim's history,
   flagged as poison.
2. **Send** — copy the lookalike (that is the mistake victims make) and try to
   send 1,000 mUSDT. The UI warns *LOOKALIKE*; the contract quarantines it
   for 24 h and emits `LookalikeFlagged`.
3. **Pending** — the quarantined escrow shows a countdown. Click
   *"Cancel & refund"* — funds come straight back. A raw transfer here would
   be gone forever.
4. **Send** to the *real* Terry — *VERIFIED PAYEE* badge, instant delivery,
   no escrow.
5. **Send** to the *new friend* — *UNKNOWN PAYEE*, escrowed. Switch the
   account picker to "New friend", wait out the cooldown, click *Claim* —
   the friend is paid and becomes a verified payee (see **Payees**).

## Tests

```bash
cd contracts
forge test -vvv        # 45 tests — unit, negative, event, fuzz, invariant
forge fmt --check
forge snapshot
forge coverage         # 100% lines on SafeSend.sol
```

- **Unit/negative**: instant vs escrow vs quarantine paths, cancel/claim/
  reclaim authorization, self-send, zero amounts, cooldown bounds, ETH pulls.
- **Fuzz**: random amounts, recipients, timings across all state transitions.
- **Invariant** (`SafeSend.invariant.t.sol`): router never owes more than it
  holds (ERC-20 and ETH), `nextId` monotonic, a verified recipient can never
  sit in escrow.
- **Poisoner**: zero-value `transferFrom` succeeds with no allowance
  (the attack primitive), dust path, events.
- Web: `cd web && npm test` — fingerprint TS mirror parity with the contract.

## Base Sepolia (optional)

If you have a dedicated throwaway wallet with free testnet ETH:

```bash
cp .env.example .env   # fill RPC + PRIVATE_KEY locally — NEVER commit
make deploy-base-sepolia
make verify-base-sepolia   # optional, needs BASESCAN_API_KEY
```

The key lives only in your local `.env` (gitignored). `Deploy.s.sol` writes
`web/src/deployments/84532.json`, after which the UI serves Base Sepolia.
**No private key is or should ever be committed to this repo.**

## Security model and honest limitations

- **Detection, not prevention.** SafeSend can't stop a raw `transfer()` — it
  only protects sends that go through the router. Poisoned history still
  exists; the defense is at send time.
- **Fingerprint = first/last 4 hex only.** An attacker who matches more
  characters (e.g. first 6) still defeats the check; this covers the common
  first/last-4 wallet display convention, not all lookalikes.
- **Verification is only as good as its source.** `addPayee` trusts the
  sender's out-of-band check. If a user verifies a lookalike, SafeSend can't
  help. Claim-to-verify is safer: a recipient can only claim funds actually
  routed to them.
- **Quarantine ≠ trap.** Both sender and the real recipient keep their
  powers — the sender can always cancel, the recipient can always claim
  after unlock, and either can walk away (`reclaim` after 30 days).
- **Reorgs / UI trust.** Lookalike badges depend on on-chain event reads;
  use your own RPC in anything real.
- **Unaudited.** Reviewed with unit/fuzz/invariant tests only. Do not deploy
  to mainnet or use with real funds.

## Prior art and honest disclosure

- **REVERSO / ERC-20R & ERC-721R (Stanford)** — reversible transactions via
  arbitration. SafeSend is deliberately narrower: no judges, no disputes,
  a deterministic fingerprint rule users can reason about.
- **Argent "trusted contacts"** — social contacts that gate sends.
  SafeSend grows that list automatically from successful deliveries.
- **Etherscan/explorer name-tags & wallet flags** — off-chain warnings.
  SafeSend enforces *on-chain*, so it works even if the UI lies.
- **Address-poisoning research** — the zero-value `transferFrom` insertion
  reproduced here was documented publicly (e.g. SlowMist, OZ issue #3931)
  and is replayed only against local Anvil test assets.

SafeSend does not claim to prevent every poisoning loss — it makes the most
common loss *mode* (copy-from-history → instant finality) cancellable.

## License

MIT — see `LICENSE`.
