# SafeSend demo video script — 2:45 target

Recorded against local Anvil (`make anvil && make deploy-local && make seed && make web`).
UI at `http://localhost:5173/?demo=1`. B-roll notes in brackets.
Deliverable label on screen throughout: **"UNAUDITED TESTNET PROTOTYPE — demo assets only."**

| Time   | On screen | Narration |
|--------|-----------|-----------|
| 0:00–0:15 | Title card → attacker console | "Every year, hundreds of millions of dollars leave wallets because a sender copied an address from their transaction history — and it was a lookalike. This is SafeSend: a payment router that makes that mistake cancellable." |
| 0:15–0:40 | Attacker console → click "Poison history" + "Dust victim" → History tab | "The attack takes three steps and costs an attacker nothing. Generate a lookalike sharing the first and last four hex of a real payee. Inject a zero-value transferFrom — on USDT-style tokens it needs no allowance — and dust, so the fake lands in the victim's history. There it is: two rows, flagged." |
| 0:40–1:10 | Send page → paste lookalike → LOOKALIKE badge → Send anyway | "Now the victim does what victims do: copies the last counterparty. SafeSend fingerprints every recipient — first four and last four characters. This address collides with a verified payee's fingerprint. The UI warns; the contract quarantines for twenty-four hours and emits a LookalikeFlagged event." |
| 1:10–1:35 | Pending → QUARANTINED card → Cancel & refund → settled | "On-chain, the escrow is quarantined. The attacker can never claim — only the address in `to` can. The victim cancels, and gets a full refund. That same paste into a raw transfer is gone forever; through SafeSend it's a timeout and a refund." |
| 1:35–2:00 | Send to real Terry → VERIFIED badge → instant | "Same UI, correct address: the fingerprint matches a verified payee exactly — not a collision, the real address — so funds move instantly. No escrow, no friction for the happy path." |
| 2:00–2:30 | Send to new friend → escrow → switch account → claim → Payees list | "First send to a new contact goes into a short escrow the sender can always cancel. The recipient claims after the unlock — and claiming makes them verified for all future sends. The payee book builds itself out of successful deliveries." |
| 2:30–2:45 | Slide: limitations | "No owner, no fees, no upgradeability, checks-effects-interactions, forty-five tests including fuzz and invariants at full line coverage. Honest limits: it only guards sends through the router, fingerprints only cover the first and last four characters, and it's an unaudited prototype. But the most common way people lose money to poisoning just became a cancellable escrow. SafeSend." |

## Recording checklist

- [ ] Fresh Anvil run: `make anvil`, `make deploy-local`, `make seed`, `make web`
- [ ] Browser at 1280×720+ window, dark UI, demo account picker on Victim
- [ ] Cut idle time between tx confirm and next click — Anvil confirms are instant
- [ ] Keep the "UNAUDITED TESTNET PROTOTYPE" banner in frame
- [ ] End card: repo link + "attack tooling runs on local Anvil only — educational"
