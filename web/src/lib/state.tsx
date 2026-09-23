import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, type Abi } from "viem";
import { DEMO_ACCOUNTS, demoWalletClient, type DemoAccount } from "./demo";
import { anvilChain, deploymentFor, demoParam, type Deployment } from "./chains";

export type Toast = { id: number; kind: "info" | "success" | "error"; text: string; hash?: string };

type WriteArgs = {
  to: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: readonly any[];
  value?: bigint;
};

type AppState = {
  chainId: number;
  deployment?: Deployment;
  /** connected/demo sender address, if any */
  me?: Address;
  demoMode: boolean;
  demoAccount: DemoAccount;
  setDemoAccount: (a: DemoAccount) => void;
  write: (args: WriteArgs) => Promise<`0x${string}`>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  /** awaited write with toast lifecycle; returns receipt status */
  sendTx: (label: string, args: WriteArgs) => Promise<boolean>;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [demoAccount, setDemoAccount] = useState<DemoAccount>(DEMO_ACCOUNTS[0]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Demo mode: ?demo=1, or the connected wallet is on Anvil.
  const onAnvil = account.chainId === anvilChain.id;
  const demoMode = demoParam() || onAnvil;

  const chainId = demoMode ? anvilChain.id : account.chainId ?? anvilChain.id;
  const deployment = deploymentFor(chainId);

  const me: Address | undefined = demoMode ? demoAccount.address : account.address;

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  }, []);

  const write = useCallback(
    async (args: WriteArgs): Promise<`0x${string}`> => {
      if (!deployment) throw new Error("SafeSend is not deployed on this chain");
      if (demoMode) {
        const client = demoWalletClient(demoAccount);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (client as any).writeContract({
          address: args.to,
          abi: args.abi,
          functionName: args.functionName,
          args: args.args ?? [],
          value: args.value,
        });
      }
      return writeContractAsync({
        address: args.to,
        abi: args.abi as Abi,
        functionName: args.functionName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: args.args as any,
        value: args.value,
      });
    },
    [demoMode, demoAccount, deployment, writeContractAsync]
  );

  const sendTx = useCallback(
    async (label: string, args: WriteArgs) => {
      try {
        toast({ kind: "info", text: `${label}: confirming…` });
        const hash = await write(args);
        toast({ kind: "success", text: `${label}: confirmed`, hash });
        return true;
      } catch (e) {
        const msg =
          (e as { shortMessage?: string; message?: string }).shortMessage ??
          (e as Error).message ??
          "transaction failed";
        toast({ kind: "error", text: `${label}: ${msg.split("\n")[0]}` });
        return false;
      }
    },
    [toast, write]
  );

  const value = useMemo(
    () => ({
      chainId,
      deployment,
      me,
      demoMode,
      demoAccount,
      setDemoAccount,
      write,
      toast,
      toasts,
      sendTx,
    }),
    [chainId, deployment, me, demoMode, demoAccount, write, toast, toasts, sendTx]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
