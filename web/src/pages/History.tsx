import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { fingerprint } from "../lib/fingerprint";
import { fetchPayees, fetchTokenHistory, type HistoryRow } from "../lib/router";
import { publicClientFor } from "../lib/chains";
import { useApp } from "../lib/state";
import { AddressView, CopyButton } from "../components/AddressView";

const DUST_THRESHOLD = 1_000n; // < 0.001 mUSDT

export function HistoryPage() {
  const { me, deployment, chainId } = useApp();
  const pc = publicClientFor(chainId);

  const { data } = useQuery({
    queryKey: ["history", chainId, me],
    enabled: Boolean(me && deployment),
    refetchInterval: 4000,
    queryFn: async () => {
      const [rows, payees] = await Promise.all([
        fetchTokenHistory(pc, deployment!, me!),
        fetchPayees(pc, deployment!, me!),
      ]);
      return {
        rows,
        payeeSet: new Set(payees.map((p) => p.toLowerCase())),
        fpSet: new Set(payees.map((p) => fingerprint(p))),
      };
    },
  });

  if (!me) return <p className="text-center text-zinc-500">Connect a wallet or pick a demo account.</p>;

  const rows = data?.rows ?? [];

  function flagOf(r: HistoryRow): { text: string; cls: string } | null {
    if (!data) return null;
    const cp = r.counterparty.toLowerCase();
    if (r.direction === "out" && r.zeroValue)
      return { text: "poison insert (zero-value transferFrom — no allowance needed)", cls: "text-red-400" };
    if (r.direction === "in" && r.zeroValue)
      return { text: "possible poisoning (zero-value)", cls: "text-red-400" };
    if (r.direction === "in" && r.amount > 0n && r.amount < DUST_THRESHOLD)
      return { text: "possible poisoning (dust)", cls: "text-red-400" };
    if (data.payeeSet.has(cp)) return { text: "verified payee", cls: "text-emerald-400" };
    if (data.fpSet.has(fingerprint(r.counterparty)))
      return { text: "LOOKALIKE of a verified payee", cls: "text-red-400" };
    return null;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-lg font-semibold">Token history (mUSDT)</h2>
      <p className="text-sm text-zinc-500">
        What a wallet shows you — and what an attacker exploits. Zero-value and dust rows are how
        lookalikes get inserted. Flags are computed from your on-chain payee book.
      </p>
      <div className="space-y-2">
        {rows.slice(0, 40).map((r) => {
          const flag = flagOf(r);
          return (
            <div
              key={r.txHash + r.direction}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                flag && flag.cls.includes("red")
                  ? "border-red-800/60 bg-red-950/20"
                  : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <div>
                <div className="text-xs text-zinc-500">{r.direction === "in" ? "from" : "to"}</div>
                <AddressView address={r.counterparty} />
                <CopyButton value={r.counterparty} />
                {flag && <div className={`mt-0.5 text-xs font-medium ${flag.cls}`}>{flag.text}</div>}
              </div>
              <div className="text-right font-mono text-sm">
                {r.direction === "in" ? "+" : "-"}
                {formatUnits(r.amount, 6)}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-zinc-500">No token history yet.</p>}
      </div>
    </div>
  );
}
