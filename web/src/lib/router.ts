import { type Address, type PublicClient } from "viem";
import {
  cancelledEvent,
  claimedEvent,
  escrowedEvent,
  lookalikeFlaggedEvent,
  payeeRemovedEvent,
  payeeVerifiedEvent,
  reclaimedEvent,
  safeSendAbi,
  sentEvent,
  transferEvent,
} from "./abi";
import { type Deployment } from "./chains";

export type TransferRow = {
  id: bigint;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  unlockAt: bigint;
  status: number;
  reason: number;
};

export async function fetchEscrowIds(pc: PublicClient, deploy: Deployment, me: Address) {
  const [out, inc] = await Promise.all([
    pc.getLogs({ address: deploy.safeSend, event: escrowedEvent, args: { from: me }, fromBlock: 0n }),
    pc.getLogs({ address: deploy.safeSend, event: escrowedEvent, args: { to: me }, fromBlock: 0n }),
  ]);
  const ids = new Set<bigint>();
  for (const l of [...out, ...inc]) if (l.args.id !== undefined) ids.add(l.args.id);
  return [...ids].sort((a, b) => Number(b - a));
}

export async function fetchEscrows(pc: PublicClient, deploy: Deployment, me: Address) {
  const ids = await fetchEscrowIds(pc, deploy, me);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const t = await pc.readContract({
        address: deploy.safeSend,
        abi: safeSendAbi,
        functionName: "transfers",
        args: [id],
      });
      const [token, from, to, amount, unlockAt, status, reason] = t as [
        Address, Address, Address, bigint, bigint, number, number
      ];
      return { id, token, from, to, amount, unlockAt, status, reason } as TransferRow;
    })
  );
  return rows;
}

export async function fetchFlaggedIds(pc: PublicClient, deploy: Deployment, me: Address) {
  const logs = await pc.getLogs({
    address: deploy.safeSend,
    event: lookalikeFlaggedEvent,
    args: { from: me },
    fromBlock: 0n,
  });
  const s = new Set<bigint>();
  for (const l of logs) if (l.args.id !== undefined) s.add(l.args.id);
  return s;
}

export async function fetchPayees(pc: PublicClient, deploy: Deployment, me: Address) {
  const [added, removed] = await Promise.all([
    pc.getLogs({ address: deploy.safeSend, event: payeeVerifiedEvent, args: { sender: me }, fromBlock: 0n }),
    pc.getLogs({ address: deploy.safeSend, event: payeeRemovedEvent, args: { sender: me }, fromBlock: 0n }),
  ]);
  const candidates = new Set<Address>();
  for (const l of [...added, ...removed]) if (l.args.payee) candidates.add(l.args.payee);
  const live = await Promise.all(
    [...candidates].map(async (p) => ({
      payee: p,
      verified: (await pc.readContract({
        address: deploy.safeSend,
        abi: safeSendAbi,
        functionName: "verified",
        args: [me, p],
      })) as boolean,
    }))
  );
  return live.filter((x) => x.verified).map((x) => x.payee);
}

export type HistoryRow = {
  direction: "in" | "out";
  counterparty: Address;
  amount: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  zeroValue: boolean;
};

export async function fetchTokenHistory(
  pc: PublicClient,
  deploy: Deployment,
  me: Address
): Promise<HistoryRow[]> {
  const [out, inc] = await Promise.all([
    pc.getLogs({ address: deploy.mockUSDT, event: transferEvent, args: { from: me }, fromBlock: 0n }),
    pc.getLogs({ address: deploy.mockUSDT, event: transferEvent, args: { to: me }, fromBlock: 0n }),
  ]);
  const rows: HistoryRow[] = [
    ...out.map((l) => ({
      direction: "out" as const,
      counterparty: l.args.to as Address,
      amount: l.args.value as bigint,
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      zeroValue: (l.args.value as bigint) === 0n,
    })),
    ...inc.map((l) => ({
      direction: "in" as const,
      counterparty: l.args.from as Address,
      amount: l.args.value as bigint,
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      zeroValue: (l.args.value as bigint) === 0n,
    })),
  ];
  return rows.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

export async function fetchSentCount(pc: PublicClient, deploy: Deployment, me: Address) {
  const logs = await pc.getLogs({
    address: deploy.safeSend,
    event: sentEvent,
    args: { from: me },
    fromBlock: 0n,
  });
  return logs.length;
}

export { claimedEvent, cancelledEvent, reclaimedEvent };
