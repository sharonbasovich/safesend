import { type Address } from "viem";

/// Renders an address the way wallets truncate it — but keeps the dangerous
/// part visible: first 4 and last 4 hex chars are bold, the middle is dimmed.
/// A lookalike is pixel-identical to the real payee at this size.
export function AddressView({
  address,
  full = false,
  className = "",
}: {
  address: Address;
  full?: boolean;
  className?: string;
}) {
  const a = address;
  const head = a.slice(0, 6); // 0x + first 4
  const tail = a.slice(-4);
  return (
    <span className={`font-mono ${className}`} title={a}>
      <span className="font-bold text-zinc-50">{head}</span>
      <span className="text-zinc-600">{full ? a.slice(6, -4) : "…"}</span>
      <span className="font-bold text-zinc-50">{tail}</span>
    </span>
  );
}

export function CopyButton({ value }: { value: string }) {
  return (
    <button
      className="ml-2 rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
      onClick={() => navigator.clipboard.writeText(value)}
      title="Copy address — this is exactly how poisoning happens"
    >
      copy
    </button>
  );
}
