import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import { safeSendAbi } from "../lib/abi";
import { fingerprint } from "../lib/fingerprint";
import { fetchPayees } from "../lib/router";
import { publicClientFor } from "../lib/chains";
import { useApp } from "../lib/state";
import { AddressView } from "../components/AddressView";

export function PayeesPage() {
  const { me, deployment, chainId, sendTx } = useApp();
  const pc = publicClientFor(chainId);
  const [addr, setAddr] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: payees, refetch } = useQuery({
    queryKey: ["payees", chainId, me],
    enabled: Boolean(me && deployment),
    refetchInterval: 5000,
    queryFn: () => fetchPayees(pc, deployment!, me!),
  });

  const confirmed = confirm.trim().toUpperCase() === "VERIFY" && isAddress(addr);

  async function add() {
    if (!deployment || !confirmed) return;
    setBusy(true);
    const ok = await sendTx("Verify payee", {
      to: deployment.safeSend,
      abi: safeSendAbi,
      functionName: "addPayee",
      args: [addr],
    });
    if (ok) {
      setAddr("");
      setConfirm("");
      refetch();
    }
    setBusy(false);
  }

  async function remove(p: string) {
    if (!deployment) return;
    setBusy(true);
    await sendTx("Remove payee", {
      to: deployment.safeSend,
      abi: safeSendAbi,
      functionName: "removePayee",
      args: [p],
    });
    setBusy(false);
    refetch();
  }

  if (!me) return <p className="text-center text-zinc-500">Connect a wallet or pick a demo account.</p>;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-lg font-semibold">Verified payees</h2>
      <p className="text-sm text-zinc-500">
        Sends to these addresses skip escrow entirely. Only add an address you verified
        out-of-band — this list is exactly what a lookalike tries to sneak onto.
      </p>

      <div className="space-y-2">
        {(payees ?? []).map((p) => (
          <div
            key={p}
            className="flex items-center justify-between rounded-lg border border-emerald-900/60 bg-zinc-900/60 px-4 py-3"
          >
            <div>
              <AddressView address={p} full className="break-all text-xs" />
              <div className="mt-0.5 font-mono text-xs text-zinc-500">
                fp 0x{fingerprint(p).toString(16).padStart(8, "0")}
              </div>
            </div>
            <button
              onClick={() => remove(p)}
              disabled={busy}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
        {(payees ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">No verified payees yet.</p>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-2 text-sm font-semibold">Add a payee (manual verification)</h3>
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value.trim())}
          placeholder="0x…"
          className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
          spellCheck={false}
        />
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder='Type "VERIFY" to confirm you checked this address out-of-band'
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={add}
          disabled={busy || !confirmed}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Mark as verified
        </button>
      </div>
    </div>
  );
}
