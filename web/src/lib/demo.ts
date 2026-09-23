// Demo wallet — Anvil dev accounts only. These are the well-known public
// Foundry/Anvil keys; they hold zero real value and exist for local demos.
// Injected-connector (MetaMask) usage is unaffected.

import { createWalletClient, http, type WalletClient, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvilChain, ANVIL_RPC } from "./chains";

export type DemoAccount = {
  id: string;
  label: string;
  address: Address;
  privateKey: `0x${string}`;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "victim",
    label: "Victim (you)",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    id: "terry",
    label: "Terry (verified payee)",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    id: "friend",
    label: "New friend",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  },
  {
    id: "attacker",
    label: "Attacker",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
];

// Deterministic lookalike of Terry: same 0x7099…79c8 fingerprint, different
// middle. Controlled by nobody — Anvil impersonation fills in for the key.
export const DEMO_LOOKALIKE: Address = "0x7099deadbeefcafe1234567890abcdef012379c8";

export function demoWalletClient(acc: DemoAccount): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(acc.privateKey),
    chain: anvilChain,
    transport: http(ANVIL_RPC),
  });
}

// Sends a tx from an impersonated Anvil account (attacker-console use only).
export async function impersonatedWrite(args: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: readonly any[];
  contract: Address;
}): Promise<`0x${string}`> {
  const { createTestClient } = await import("viem");
  const testClient = createTestClient({ chain: anvilChain, transport: http(ANVIL_RPC), mode: "anvil" });
  await testClient.impersonateAccount({ address: args.address });
  await testClient.setBalance({ address: args.address, value: 10n ** 18n });
  try {
    const wallet = createWalletClient({
      account: args.address,
      chain: anvilChain,
      transport: http(ANVIL_RPC),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await (wallet as any).writeContract({
      address: args.contract,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args ?? [],
    });
    return hash;
  } finally {
    await testClient.stopImpersonatingAccount({ address: args.address });
  }
}
