import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits, zeroAddress, type Address } from "viem";
import { useEffect, useState } from "react";
import { safeSendAbi } from "../lib/abi";
import { fetchEscrows, fetchFlaggedIds, type TransferRow } from "../lib/router";
import { publicClientFor } from "../lib/chains";
import { useApp } from "../lib/state";
import { AddressView } from "../components/AddressView";

const RECLAIM_AFTER = 30n * 24n * 3600n;

function Countdown({ unlockAt }: { unlockAt: bigint }) {
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Number(unlockAt - now);
  if (left <= 0) return <span className="text-emerald-400">unlocked</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span className="font-mono text-amber-400">
      {h > 0 ? `${h}h ` : ""}
      {m}m {s}s
    </span>
  );
}

function Card({ t, flagged }: { t: TransferRow; flagged: boolean }) {
  const { me, deployment, sendTx } = useApp();
  const iAmSender = me?.toLowerCase() === t.from.toLowerCase();
  const iAmRecipient = me?.toLowerCase() === t.to.toLowerCase();
  const pending = t.status === 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const unlocked = now >= t.unlockAt;
  const reclaimable = now >= t.unlockAt + RECLAIM_AFTER;
  const isEth = t.token === zeroAddress;
  const counterparty: Address = iAmSender ? t.to : t.from;
  const [busy, setBusy] = useState(false);

  async function act(fn: "claim" | "cancel" | "reclaim") {
    if (!deployment) return;
    setBusy(true);
    await sendTx(fn === "claim" ? "Claim" : fn === "cancel" ? "Cancel & refund" : "Reclaim", {
      to: deployment.safeSend,
      abi: safeSendAbi,
      functionName: fn,
      args: [t.id],
    });
    setBusy(false);
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        flagged
          ? "border-red-700 bg-red-950/30"
          : "border-zinc-800 bg-zinc-900/60"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-400">escrow #{t.id.toString()}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            flagged ? "bg-red-800/60 text-red-200" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {flagged ? "QUARANTINED — lookalike" : ["Pending", "Claimed", "Cancelled", "Reclaimed"][t.status]}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-500">{iAmSender ? "to" : "from"}</div>
          <AddressView address={counterparty} />
        </div>
        <div className="text-right">
          <div className="font-mono text-lg">
            {isEth ? `${formatEther(t.amount)} ETH` : `${formatUnits(t.amount, 6)} mUSDT`}
          </div>
          <div className="text-xs text-zinc-500">
            {pending ? <Countdown unlockAt={t.unlockAt} /> : "settled"}
          </div>
        </div>
      </div>

      {pending && (
        <div className="mt-4 flex gap-2">
          {iAmSender && (
            <button
              disabled={busy}
              onClick={() => act("cancel")}
              className="flex-1 rounded-lg bg-red-700 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
            >
              Cancel & refund
            </button>
          )}
          {iAmRecipient && (
            <button
              disabled={busy || !unlocked}
              onClick={() => act("claim")}
              className="flex-1 rounded-lg bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              {unlocked ? "Claim (becomes verified payee)" : "Claim — locked"}
            </button>
          )}
          {iAmSender && !unlocked && iAmRecipient === false && null}
          {iAmSender && reclaimable && (
            <button
              disabled={busy}
              onClick={() => act("reclaim")}
              className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm font-semibold text-white hover:bg-zinc-600 disabled:opacity-40"
            >
              Reclaim (unclaimed 30d)
            </button>
          )}
        </div>
      )}
      {pending && iAmRecipient && !unlocked && (
        <p className="mt-2 text-xs text-zinc-500">
          Locked until the window ends — the sender can cancel at any time.
        </p>
      )}
    </div>
  );
}

export function PendingPage() {
  const { me, deployment, chainId } = useApp();
  const pc = publicClientFor(chainId);

  const { data } = useQuery({
    queryKey: ["escrows", chainId, me],
    enabled: Boolean(me && deployment),
    refetchInterval: 4000,
    queryFn: async () => {
      const [rows, flagged] = await Promise.all([
        fetchEscrows(pc, deployment!, me!),
        fetchFlaggedIds(pc, deployment!, me!),
      ]);
      return { rows, flagged };
    },
  });

  if (!me)
    return <p className="text-center text-zinc-500">Connect a wallet or pick a demo account.</p>;

  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status === 0);
  const settled = rows.filter((r) => r.status !== 0);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-lg font-semibold">Pending & quarantine</h2>
      {pending.length === 0 && (
        <p className="text-sm text-zinc-500">No pending escrows for this account.</p>
      )}
      {pending.map((t) => (
        <Card key={t.id.toString()} t={t} flagged={data?.flagged.has(t.id) ?? t.reason === 1} />
      ))}
      {settled.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-semibold text-zinc-500">Settled</h3>
          {settled.map((t) => (
            <Card key={t.id.toString()} t={t} flagged={false} />
          ))}
        </>
      )}
    </div>
  );
}
