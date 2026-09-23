import { useState } from "react";
import { type Address } from "viem";
import { erc20Abi, poisonerAbi } from "../lib/abi";
import { fingerprint } from "../lib/fingerprint";
import { publicClientFor } from "../lib/chains";
import { DEMO_ACCOUNTS, DEMO_LOOKALIKE, demoWalletClient, impersonatedWrite } from "../lib/demo";
import { useApp } from "../lib/state";
import { AddressView, CopyButton } from "../components/AddressView";

const attacker = DEMO_ACCOUNTS.find((a) => a.id === "attacker")!;
const victim = DEMO_ACCOUNTS.find((a) => a.id === "victim")!;
const terry = DEMO_ACCOUNTS.find((a) => a.id === "terry")!;

/// Attacker console — EDUCATIONAL ATTACK REPRODUCTION on local Anvil only.
/// Reproduces the two real techniques that plant a lookalike into a victim's
/// transaction history. No real addresses, no real funds.
export function AttackerPage() {
  const { deployment, chainId, toast } = useApp();
  const pc = publicClientFor(chainId);
  const [target, setTarget] = useState<Address>(terry.address);
  const [lookalike, setLookalike] = useState<Address>(DEMO_LOOKALIKE);
  const [busy, setBusy] = useState(false);

  function regen() {
    // a lookalike is FREE to fabricate for our detector: keep first/last 4 hex,
    // randomize the 32 middle hex chars — no key grinding needed on Anvil
    const t = target.toLowerCase().replace("0x", "");
    let mid = "";
    const hex = "0123456789abcdef";
    for (let i = 0; i < 32; i++) mid += hex[Math.floor(Math.random() * 16)];
    setLookalike(`0x${t.slice(0, 4)}${mid}${t.slice(-4)}` as Address);
  }

  async function poison() {
    if (!deployment) return;
    setBusy(true);
    try {
      toast({ kind: "info", text: "Firing zero-value transferFrom (no allowance needed)…" });
      const client = demoWalletClient(attacker);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await (client as any).writeContract({
        address: deployment.poisoner,
        abi: poisonerAbi,
        functionName: "poison",
        args: [deployment.mockUSDT, victim.address, lookalike],
      });
      await pc.waitForTransactionReceipt({ hash });
      toast({
        kind: "success",
        text: "Poisoned: victim's outgoing history now lists the lookalike",
        hash,
      });
    } catch (e) {
      toast({ kind: "error", text: `poison failed: ${(e as Error).message.split("\n")[0]}` });
    }
    setBusy(false);
  }

  async function dust() {
    if (!deployment) return;
    setBusy(true);
    try {
      toast({ kind: "info", text: "Minting to lookalike + impersonating (Anvil only)…" });
      const client = demoWalletClient(attacker);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h1 = await (client as any).writeContract({
        address: deployment.mockUSDT,
        abi: erc20Abi,
        functionName: "mint",
        args: [lookalike, 1_000_000n],
      });
      await pc.waitForTransactionReceipt({ hash: h1 });

      const hash = await impersonatedWrite({
        address: lookalike,
        contract: deployment.mockUSDT,
        abi: erc20Abi,
        functionName: "transfer",
        args: [victim.address, 42n],
      });
      await pc.waitForTransactionReceipt({ hash });
      toast({
        kind: "success",
        text: "Dust sent: victim's incoming history now shows the lookalike",
        hash,
      });
    } catch (e) {
      toast({ kind: "error", text: `dust failed: ${(e as Error).message.split("\n")[0]}` });
    }
    setBusy(false);
  }

  const sameFp =
    target.length === 42 &&
    lookalike.length === 42 &&
    fingerprint(target) === fingerprint(lookalike);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        ATTACK REPRODUCTION — local Anvil only, for education. These are the exact
        techniques real address-poisoning campaigns use. Never run against real addresses or funds.
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-3 text-lg font-semibold">Attacker console</h2>

        <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
          Target payee (victim's verified contact)
        </label>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value as Address)}
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none"
          spellCheck={false}
        />

        <div className="mb-3">
          <div className="text-xs text-zinc-500">Lookalike (same first/last 4 hex)</div>
          <div className="mt-1 flex items-center justify-between rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2">
            <AddressView address={lookalike} className="text-lg" />
            <CopyButton value={lookalike} />
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-500">
            {sameFp
              ? `fingerprint match: 0x${fingerprint(lookalike).toString(16).padStart(8, "0")}`
              : "fingerprint does not match — regenerate"}
          </div>
        </div>

        <button
          onClick={regen}
          className="mb-4 w-full rounded-lg bg-zinc-800 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-700"
        >
          Generate new lookalike (free on Anvil)
        </button>

        <div className="space-y-2">
          <button
            onClick={poison}
            disabled={busy}
            className="w-full rounded-lg bg-red-700 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
          >
            1. Poison history — zero-value transferFrom
          </button>
          <button
            onClick={dust}
            disabled={busy}
            className="w-full rounded-lg bg-red-800 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            2. Dust victim from lookalike (impersonation)
          </button>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Then, as the victim: check History — the lookalike now looks like Terry. Copy it, send
          1,000 mUSDT to it. A raw transfer is gone forever; a SafeSend send lands in quarantine.
        </p>
      </div>
    </div>
  );
}
