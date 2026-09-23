# Generating a lookalike address — EDUCATION ONLY

Address-poisoning attackers grind private keys until the address shares the
first and last ~4 hex characters with a target payee, so it is visually
indistinguishable when truncated (`0x7099…79c8`).

On a real chain this requires ~4 billion key trials for a 4+4 match. With
Foundry:

```bash
# ~1–2 hours on a modern laptop for 4+4; use 3+3 if you just want to see it work
cast wallet vanity --starts-with 7099 --ends-with 79c8
```

## What the demo does instead

The demo does **not** grind keys. On local Anvil we don't need the lookalike's
private key at all:

- `Poisoner.poison()` (zero-value `transferFrom(victim, lookalike, 0)`) needs
  **no** allowance and **no** lookalike key — that is precisely why the real
  attack works.
- The dust leg (`lookalike -> victim`) is sent via `anvil_impersonateAccount`,
  which only works on a local dev node.

So `scripts/seed-demo.ts` uses a deterministic lookalike —
`0x7099deadbeefcafe1234567890abcdef012379c8`, which shares Terry's
`0x7099…79c8` fingerprint — and the attacker console reaches it through
impersonation. Everything is confined to Anvil/test assets.
