# SafeSend demo v2 — storyboard (1:59, ≤ 2:30)

`safesend-demo-v2.mp4` — 1920×1080, 30 fps, H.264, 119.1 s, no audio track (burned-in captions).
SHA-256: see `safesend-demo-v2.mp4.sha256`.

Recorded in one unedited take (only head/tail trim + fades) against a **fresh local Anvil**
(chain 31337) with mock mUSDT and synthetic Anvil addresses. Every transaction shown is a real
transaction on that local chain; the two red "revert" lines are real `cast send` failures decoded
from the contract's custom-error selectors. No live network, no real funds, no credentials.

Regenerate: `qa/reset-chain.sh && make web` (separate shell) → `node qa/record-demo.mjs` while
screen-recording the 1920×1080 display (see "Recording" below).

| # | Time | Screenshot | On screen | Caption (verbatim) |
|---|------|------------|-----------|--------------------|
| 0 | 0:00–0:03 | — | Title card | **SafeSend** — A poison-aware payment router. Lookalike recipients are quarantined on-chain and need the sender's explicit approval. *Local Anvil demo · synthetic addresses · mock mUSDT · no real funds* |
| 1 | 0:03–0:19 | `01-attacker-console.png` | Attacker console: target = Terry `0x7099…79C8`, lookalike `0x7099deadbeefcafe1234567890abcdef012379c8`; clicks **1. Poison history** (zero-value `transferFrom`) and **2. Dust victim** | **The threat.** An attacker fabricates `0x7099…79c8` — same first/last 4 hex as Terry, the victim's verified payee — and plants it in the victim's history. |
| 1b | 0:19–0:27 | `02-history-poisoned.png` | Victim's History tab: lookalike rows flagged `possible poisoning (dust)` / `poison insert (zero-value transferFrom)` next to real Terry rows | As the victim, History now shows the lookalike right next to Terry. Copy the wrong one and a raw transfer is gone forever. |
| 2 | 0:27–0:38 | `03-send-lookalike-warning.png` | Send tab: paste lookalike → red **LOOKALIKE — same first/last 4 hex as a verified payee (0x7099…79C8)** warning; button becomes **Send anyway (24h quarantine)**; click | **Flagged send.** Pasting the lookalike into SafeSend: the router compares fingerprints and warns **LOOKALIKE** before anything moves. |
| 3 | 0:38–0:48 | `04-pending-sender-full-address.png` | Pending tab (sender): red **QUARANTINED — lookalike** card, full 42-char recipient address with the differing middle in amber, `24h 0m 0s` countdown, **Cancel & refund** and **Approve escrow #2** buttons | **Sender review.** The quarantined card shows the **full 42-character address**, the 24h lock, and two choices: approve, or cancel & refund. |
| 4 | 0:48–0:55 | `05-recipient-locked.png` | Switch to *Lookalike recipient (impersonated)*: same red card, disabled **Claim — needs sender approval**, recipient copy: "You cannot claim until the sender approves this escrow on-chain and the 24-hour lock ends; the sender can cancel and take a refund at any time before you claim." | **Recipient view.** The lookalike sees the same red QUARANTINED card. Claim is locked. |
| 4b | 0:55–1:12 | `06-recipient-unlocked-blocked.png`, `06b-nonsender-approve-rejected.png` | `anvil_increaseTime 86400` → card shows **unlocked**, button still disabled. Terminal panel: `cast send --from 0x7099…79c8 SafeSend "claim(uint256)" 2` → **revert NotApproved()**; `cast send --from 0x3C44…93BC SafeSend "approveLookalike(uint256)" 2` → **revert NotSender()** | Fast-forward 24 hours on Anvil (`anvil_increaseTime 86400`). The lock has expired… / **Blocked.** Unlocked but **not approved**: the button stays disabled — "Claim — needs sender approval". / And the contract agrees. Forcing a raw `claim()` from the recipient on-chain (impersonated on Anvil)… / Approval is **sender-only**. Anyone else calling `approveLookalike()` — here, the attacker — is rejected too. |
| 5 | 1:12–1:26 | `07-sender-approved.png` | Back as Victim → Pending → click **Approve escrow #2** → toast "Approve flagged recipient: confirmed"; card now shows only **Cancel & refund** plus: "Approved for this escrow. Once this address claims, it becomes verified for future instant sends. You can still cancel while pending." | **Explicit approval.** Back as the sender. After checking every character of the address out-of-band, the sender approves this one escrow. |
| 6 | 1:26–1:37 | `08-recipient-claimable.png`, `09-recipient-claimed.png` | Recipient view: enabled green **Claim (becomes verified payee)** → click → escrow #2 moves to Settled / **Claimed** | **Post-unlock claim.** Approved *and* unlocked — only now does the recipient get an enabled Claim button. |
| 7 | 1:37–1:53 | `10-payees-verified.png`, `11-send-now-verified-instant.png` | Victim → Payees: two full-address entries with fingerprint `0x709979c8` — Terry and the newly verified lookalike. Send tab: paste the same address → green **VERIFIED PAYEE — funds move instantly, no escrow**, button **Send instantly** | **The consequence.** A successful approved claim **verifies** that exact address for the sender. / Future sends to it are **instant** — no escrow, no second look. Approve only an address you have confirmed out-of-band. |
| 8 | 1:53–1:59 | — | End card | **SafeSend** — Verified → instant. Unknown → escrow. Lookalike → 24h quarantine + on-chain flag, sender approval required, cancellable until claimed. *Unaudited prototype · runs on local Anvil · github.com/sharonbasovich/safesend* |

Throughout: red top banner **UNAUDITED TESTNET PROTOTYPE — demo assets only. Do not use with real funds.**
and a top-right badge `local Anvil · chain 31337 · mock mUSDT · synthetic addresses`.

## Not shown (time budget) — covered by the old public demo and by QA
- Sender **Cancel & refund** while pending (the button is visible in scenes 3 and 5; the exact
  1,000 mUSDT refund is verified in `qa/anvil-negative-tests.result.txt` §6–7 and in the browser QA).
- Cancel *after* approval but before claim (`qa/anvil-negative-tests.result.txt` §7).

## Recording
```bash
# terminal 1
qa/reset-chain.sh            # fresh anvil + deploy + seed (kills any running anvil)
make web                     # vite on :5173
# terminal 2 (display 1920x1080, Chrome fullscreen on http://localhost:5173/?demo=1, CDP on :29229)
ffmpeg -f x11grab -draw_mouse 0 -framerate 30 -video_size 1920x1080 -i :0 -c:v libx264 -crf 18 -pix_fmt yuv420p raw.mp4 &
node qa/record-demo.mjs      # writes docs/demo-v2/screenshots/*.png + scenes.json
kill -INT %1
# trim ~3 s of pre-roll, add fades
ffmpeg -ss 3.0 -i raw.mp4 -t 119.13 -vf "fade=t=in:d=0.5,fade=t=out:st=118.43:d=0.7" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an safesend-demo-v2.mp4
```
Voiceover was deliberately omitted: no reliable TTS on the recording box, and captions carry the
narrative on their own. A narrator can read the caption column above as the script (~120 words).
