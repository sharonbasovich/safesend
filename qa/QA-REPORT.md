# SafeSend — independent QA report (2026-09-24)

Reviewed: `sharonbasovich/safesend` @ `292e205d964c36799db7b6a83350422ae586a87a` (main), the static
showcase https://sharonbasovich.github.io/safesend/ and the deck
https://sharonbasovich.github.io/safesend/media/deck.pdf.
Environment: Ubuntu, Foundry 1.8.3 (`forge`/`anvil`/`cast`), Node v24.19.0, local Anvil chain 31337
only. No live network, no real funds, no credentials used.

## Verdict

**No contract-level security flaw found.** The flagged-lookalike escrow model behaves exactly as
claimed: flagged on-chain, 24 h lock, claim requires *both* unlock and per-transfer sender approval,
approval is sender-only, sender can cancel/refund until the claim, and a successful approved claim
verifies the exact recipient address for future instant sends.

**Three material UX issues** (all in the web UI, none in the contract) were found in browser QA and
patched in this branch (`codex/safesend-demo-v2`, see "Patches"). One **documentation gap** and one
**design edge case** are listed under "Findings" for the team to decide on.

## 1. Source / security review (contract)

`contracts/src/SafeSend.sol` — read in full. Relevant invariants, confirmed in code and by tests:

| Property | Where | Result |
|---|---|---|
| Lookalike of a verified payee ⇒ escrow, `unlockAt = now + LOOKALIKE_LOCK (24h)`, `LookalikeFlagged` emitted | `send()` | OK |
| `approveLookalike(id)`: `msg.sender == t.from`, `Pending`, `reason == LookalikeOfVerified` | `approveLookalike()` | OK — non-sender → `NotSender()` |
| `claim(id)`: `msg.sender == t.to`, `Pending`, `block.timestamp >= unlockAt`, and for flagged transfers `lookalikeApproved[id]` | `claim()` | OK — before unlock → `Locked()`, after unlock w/o approval → `NotApproved()` |
| `cancel(id)`: sender-only, any time while `Pending` (incl. after approval) → refund | `cancel()` | OK |
| Successful claim ⇒ `_verify(t.from, t.to)` (exact address, per-sender) | `claim()` | OK — future sends instant |
| Status set before payout (CEI) + `nonReentrant` on `send/claim/cancel` | all | OK |
| No owner, no fees, no upgradeability, no external calls except token + ETH payout | whole file | OK |

Fingerprint = first 4 + last 4 hex chars (`fingerprint.ts` mirrors the Solidity). This is the
documented limitation: an address that differs only in the middle is *exactly* what gets flagged;
an address that differs in the visible prefix/suffix is treated as "unknown payee" (escrowed with
the sender's cooldown, no approval needed). Documented in README and deck — consistent.

### Commands / results
```
$ cd contracts && forge test
Ran 4 test suites in 259.66ms: 58 tests passed, 0 failed, 0 skipped (58 total tests)
  (fuzz: 512 runs; invariants: 128 runs, depth 32)
$ forge fmt --check            → OK (no diff)
$ cd web && npm test -- --run  → Test Files 1 passed (1), Tests 4 passed (4)
$ npm run typecheck            → OK
$ npm run build                → OK (pre-existing chunk-size warning only)
```

## 2. Contract-level negative tests on live local Anvil

Script: `qa/anvil-negative-tests.sh` (cast-driven, impersonates the keyless lookalike with
`anvil_impersonateAccount`). Log: `qa/anvil-negative-tests.result.txt`.

```
$ export PATH=$HOME/.foundry/bin:$PATH
$ anvil --chain-id 31337 &            # fresh chain
$ make deploy-local && make seed      # SafeSend 0x5FbD…0aa3, MockUSDT 0xe7f1…0512, Poisoner 0x9fE4…a6e0
$ qa/anvil-negative-tests.sh
...
RESULT: 30 passed, 0 failed
```

What it proves (each a real tx / revert on chain, decoded from the custom-error selector):

| § | Check | Result |
|---|---|---|
| 1 | Victim → lookalike `0x7099deadbeefcafe1234567890abcdef012379c8` (1,000 mUSDT): `LookalikeFlagged` emitted, `reason == LookalikeOfVerified`, `unlockAt == now+86400`, funds escrowed | PASS |
| 2 | Recipient `claim()` before unlock | `Locked()` |
| 3 | `anvil_increaseTime 86401` + `evm_mine`; recipient `claim()` unapproved | `NotApproved()`; lookalike **not** verified afterwards |
| 4 | `approveLookalike()` from attacker and from recipient | `NotSender()` ×2; `lookalikeApproved` still false |
| 5 | `claim()` from non-recipient / `cancel()` from third party | `NotRecipient()` / `NotSender()` |
| 6 | Sender `cancel()` after unlock, unapproved | OK; victim refunded exactly 1,000 mUSDT; `Cancelled`; second cancel → `NotPending()` |
| 7 | New flagged escrow: approve, then cancel before claim | OK — approval does not remove the sender's cancel right; refund correct |
| 8 | New flagged escrow: approve + 24 h → `claim()` | OK; `PayeeVerified` emitted; `verified(victim, lookalike) == true`; next `send()` to it is **instant** (no escrow, `nextId` unchanged) |
| 10 | ETH path: flagged ETH escrow, sender cancel | refunded (net cost = gas) |

## 3. Browser QA (Chrome against local Anvil, `http://localhost:5173/?demo=1`)

Run by the testing agent on a fresh chain (`anvil` → `make deploy-local` → `make seed` → `make web`),
17 screenshots, screen recording. Procedure is documented in `.agents/skills/testing-safesend/SKILL.md`.

| Requirement (from the brief) | Observed | Result |
|---|---|---|
| Lookalike send is flagged before sending | Send tab shows red **LOOKALIKE — same first/last 4 hex as a verified payee (0x7099…79C8)**, button becomes **Send anyway (24h quarantine)** | PASS |
| Full 42-char address visible in sender review | Pending card renders the full address (`AddressView full`) — middle now amber for legibility (patch) | PASS (after patch) |
| Recipient view visibly flagged | Recipient sees red **QUARANTINED — lookalike** card | PASS |
| Recipient not offered a premature claim | Button disabled: **Claim — needs sender approval**, both before and after unlock | PASS |
| Unapproved claim blocked after unlock (contract) | Forced `claim()` via impersonation → `NotApproved()` | PASS |
| Approval rejects non-sender (contract) | `approveLookalike()` from attacker → `NotSender()` | PASS |
| Cancel & refund still work | Sender **Cancel & refund** → status Cancelled, balance +1,000.000000 mUSDT exactly | PASS |
| Explicit approval | Sender **Approve escrow #N** → `LookalikeApproved`; sender card then shows approval + still-cancellable copy | PASS |
| Post-unlock approved claim | Recipient button becomes **Claim (becomes verified payee)** only when unlocked *and* approved; claim → Settled/Claimed | PASS |
| Future-trust consequence visible | Sender copy after approval: "Once this address claims, it becomes verified for future instant sends"; Payees lists the address; Send shows **VERIFIED PAYEE — funds move instantly, no escrow** / **Send instantly**; `nextId` unchanged after the instant send | PASS |
| Docs/demos match behaviour | README, Devpost text, deck (8 slides, SHA-256 `fb767782…8114` local == public) all describe the approval requirement; showcase states Pages is static and tx need local Anvil; old video `docs/safesend-demo-anvil-e2e.mp4` shows the still-valid cancel path but predates the approve button (already disclosed on the showcase) | PASS, see finding D1 |

## 4. Findings

### UX (material — patched in this branch)
- **U1 Recipient saw sender-oriented copy.** The flagged recipient card said "Check the full
  recipient address above before approving… You can still cancel", but the recipient can neither
  approve nor cancel and the address shown above them is the *sender's*. Fixed: separate sender /
  recipient copy in `web/src/pages/Pending.tsx`; recipient copy now states it cannot claim until the
  sender approves on-chain and the 24 h lock ends, and that the sender may cancel until claim.
- **U2 Payees list could not distinguish Terry from the verified lookalike** (both rendered
  `0x7099…79C8`; hover-only tooltip). Since this list *is* the future-trust consequence, it must be
  unambiguous. Fixed: full addresses in `web/src/pages/Payees.tsx`.
- **U3 Full-address middle was near-invisible** (`text-zinc-600` on dark). Fixed: amber middle in
  `web/src/components/AddressView.tsx` so the *differing* characters are the most visible part.
- **U4 Revert toasts lost the reason** (e.g. "Send: reverted" with no error name). Fixed: SafeSend +
  ERC-20 custom errors added to `web/src/lib/abi.ts`; `failureText()` in `web/src/lib/state.tsx`
  surfaces `reverted (NotApproved)` etc.
- **U5 (demo/QA only)** The demo account picker had no way to act *as* the keyless lookalike, so
  the recipient view could not be exercised in the browser. Added a 5th picker entry
  ("Lookalike recipient (impersonated)") routed through `anvil_impersonateAccount`
  (`web/src/lib/demo.ts`, `state.tsx`). Demo-mode only; no effect on wallet mode.

### Documentation
- **D1** `docs/video-script.md` targets 2:45 and its cancel-only narrative predates the approve
  button. The new `docs/demo-v2/storyboard.md` supersedes it for the submission video; consider
  deleting or pointing the old script at the new one before the deadline.

### Design edge case (not a bug, documented for awareness)
- **E1 `reason` is fixed at send time.** An escrow created while the recipient was merely an
  *unknown payee* keeps `reason = UnknownPayee` even if the sender later verifies a colliding
  payee (making the recipient a lookalike). That older escrow can then be claimed after its
  cooldown without approval (`qa/anvil-negative-tests.result.txt` §9). This is consistent with the
  documented model (classification happens at `send()`), the sender still sees it under Pending and
  can cancel it, and re-classifying escrows retroactively would open its own griefing vectors — so
  no change recommended, but worth a sentence in the README's limitations.

### Not findings (checked and fine)
- GitHub Pages showcase is clearly labelled static; no wallet connect or tx on Pages. Deck PDF on
  Pages is byte-identical to `docs/deck.pdf`.
- `demoWalletClient` uses only the well-known Anvil dev keys; nothing secret is in the repo.
- Attacker tooling (`Poisoner`) is deployed only by the local deploy script and labelled
  "local Anvil only — educational" in the UI.

## 5. Patches in this branch

```
$ git diff --stat 292e205d HEAD -- web .agents
 .agents/skills/testing-safesend/SKILL.md | 30 ++++++++++++++++++++++++++++--
 web/src/components/AddressView.tsx       |  6 +++++-
 web/src/lib/abi.ts                       | 15 +++++++++++++++
 web/src/lib/demo.ts                      | 21 +++++++++++++++------
 web/src/lib/state.tsx                    | 32 +++++++++++++++++++++++++-------
 web/src/pages/Payees.tsx                 |  2 +-
 web/src/pages/Pending.tsx                |  9 ++++++++-
```
No contract changes. `forge test`, `npm run typecheck`, `npm test`, `npm run build` pass after the
patches.

## 6. Demo media

`docs/demo-v2/` — `safesend-demo-v2.mp4` (1:59, 1920×1080, captions burned in), 12 screenshots,
`storyboard.md`, `scenes.json`, `safesend-demo-v2.mp4.sha256`. Driver: `qa/record-demo.mjs`.
