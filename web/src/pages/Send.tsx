import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits, isAddress, parseEther, parseUnits, zeroAddress, type Address } from "viem";
import { erc20Abi, safeSendAbi } from "../lib/abi";
import { fingerprint } from "../lib/fingerprint";
import { fetchPayees } from "../lib/router";
import { publicClientFor } from "../lib/chains";
import { useApp } from "../lib/state";
import { AddressView } from "../components/AddressView";

type Risk =
  | { kind: "verified" }
  | { kind: "lookalike"; match?: Address }
  | { kind: "unknown"; cooldown: bigint };

export function SendPage() {
  const { me, deployment, chainId, sendTx, toast } = useApp();
  const pc = publicClientFor(chainId);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState<"mUSDT" | "ETH">("mUSDT");
  const [busy, setBusy] = useState(false);

  const validTo = isAddress(to) && me && to.toLowerCase() !== me.toLowerCase();

  const { data: risk } = useQuery<Risk>({
    queryKey: ["risk", chainId, me, to],
    enabled: Boolean(me && deployment && validTo),
    refetchInterval: 4000,
    queryFn: async () => {
      const target = to as Address;
      const [verified, lookalike, cooldown] = await Promise.all([
        pc.readContract({
          address: deployment!.safeSend,
          abi: safeSendAbi,
          functionName: "verified",
          args: [me!, target],
        }) as Promise<boolean>,
        pc.readContract({
          address: deployment!.safeSend,
          abi: safeSendAbi,
          functionName: "isLookalike",
          args: [me!, target],
        }) as Promise<boolean>,
        pc.readContract({
          address: deployment!.safeSend,
          abi: safeSendAbi,
          functionName: "getCooldown",
          args: [me!],
        }) as Promise<bigint>,
      ]);
      if (verified) return { kind: "verified" };
      if (lookalike) {
        const payees = await fetchPayees(pc, deployment!, me!);
        const match = payees.find((p) => fingerprint(p) === fingerprint(target));
        return { kind: "lookalike", match };
      }
      return { kind: "unknown", cooldown };
    },
  });

  const amountWei = useMemo(() => {
    try {
      return asset === "mUSDT" ? parseUnits(amount || "0", 6) : parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [asset, amount]);

  const { data: balance } = useQuery({
    queryKey: ["bal", chainId, me, asset],
    enabled: Boolean(me && deployment),
    refetchInterval: 5000,
    queryFn: async () =>
      asset === "mUSDT"
        ? ((await pc.readContract({
            address: deployment!.mockUSDT,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [me!],
          })) as bigint)
        : pc.getBalance({ address: me! }),
  });

  const { data: allowance } = useQuery({
    queryKey: ["allowance", chainId, me],
    enabled: Boolean(me && deployment && asset === "mUSDT"),
    refetchInterval: 5000,
    queryFn: async () =>
      (await pc.readContract({
        address: deployment!.mockUSDT,
        abi: erc20Abi,
        functionName: "allowance",
        args: [me!, deployment!.safeSend],
      })) as bigint,
  });

  const needsApprove = asset === "mUSDT" && (allowance ?? 0n) < amountWei;

  async function approve() {
    if (!deployment) return;
    setBusy(true);
    await sendTx("Approve mUSDT", {
      to: deployment.mockUSDT,
      abi: erc20Abi,
      functionName: "approve",
      args: [deployment.safeSend, 2n ** 256n - 1n],
    });
    setBusy(false);
  }

  async function send() {
    if (!deployment || !validTo || amountWei === 0n) return;
    setBusy(true);
    const ok = await sendTx("Send", {
      to: deployment.safeSend,
      abi: safeSendAbi,
      functionName: "send",
      args: [asset === "mUSDT" ? deployment.mockUSDT : zeroAddress, to as Address, amountWei],
      value: asset === "ETH" ? amountWei : 0n,
    });
    if (ok && risk) {
      if (risk.kind === "verified") toast({ kind: "success", text: "Verified payee — sent instantly." });
      else if (risk.kind === "lookalike")
        toast({ kind: "error", text: "QUARANTINED: lookalike flagged — see Pending to cancel." });
      else toast({ kind: "info", text: "Escrowed — recipient must claim after the cooldown." });
    }
    setBusy(false);
  }

  if (!deployment)
    return <p className="text-zinc-400">SafeSend is not deployed on this chain yet.</p>;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Send</h2>

        <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Asset</label>
        <div className="mb-4 flex gap-2">
          {(["mUSDT", "ETH"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAsset(a)}
              className={`rounded-lg px-4 py-2 text-sm ${
                asset === a ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {a}
            </button>
          ))}
          {balance !== undefined && (
            <span className="ml-auto self-center text-sm text-zinc-500">
              balance:{" "}
              {asset === "mUSDT" ? `${formatUnits(balance, 6)} mUSDT` : `${formatEther(balance)} ETH`}
            </span>
          )}
        </div>

        <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
          Recipient address
        </label>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="0x… (paste from history — carefully)"
          className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
          spellCheck={false}
        />

        {validTo && risk && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              risk.kind === "verified"
                ? "border-emerald-800 bg-emerald-950/50 text-emerald-300"
                : risk.kind === "lookalike"
                  ? "border-red-800 bg-red-950/50 text-red-300"
                  : "border-amber-800 bg-amber-950/50 text-amber-300"
            }`}
          >
            {risk.kind === "verified" && (
              <>VERIFIED PAYEE — funds move instantly, no escrow.</>
            )}
            {risk.kind === "lookalike" && (
              <>
                LOOKALIKE — same first/last 4 hex as a verified payee
                {risk.match ? (
                  <>
                    {" "}
                    (<AddressView address={risk.match} />)
                  </>
                ) : null}
                . Escrowed 24h and flagged on-chain.
              </>
            )}
            {risk.kind === "unknown" && (
              <>UNKNOWN PAYEE — escrowed for {Number(risk.cooldown)}s until claimed.</>
            )}
          </div>
        )}

        {validTo && (
          <p className="mb-4 text-xs text-zinc-500">
            fingerprint: <span className="font-mono">0x{fingerprint(to).toString(16).padStart(8, "0")}</span>
            {" — the contract compares this, not the full address"}
          </p>
        )}

        <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
          Amount ({asset})
        </label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
        />

        {needsApprove ? (
          <button
            onClick={approve}
            disabled={busy || !me}
            className="w-full rounded-lg bg-amber-600 py-2.5 font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            Approve mUSDT for the router
          </button>
        ) : (
          <button
            onClick={send}
            disabled={busy || !me || !validTo || amountWei === 0n}
            className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {risk?.kind === "verified"
              ? "Send instantly"
              : risk?.kind === "lookalike"
                ? "Send anyway (24h quarantine)"
                : "Send into escrow"}
          </button>
        )}
      </div>

      <p className="text-center text-xs text-zinc-600">
        Verified payees: instant. Unknown: escrowed until claimed. Lookalikes: 24h quarantine +
        on-chain flag, cancellable.
      </p>
    </div>
  );
}
