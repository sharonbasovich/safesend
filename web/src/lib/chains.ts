import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

export const anvilChain: Chain = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
};

export const ANVIL_RPC = "http://127.0.0.1:8545";
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export const supportedChains = [anvilChain, baseSepolia] as const;

export type Deployment = {
  safeSend: `0x${string}`;
  mockUSDT: `0x${string}`;
  poisoner: `0x${string}`;
  chainId: number;
};

// Deployment files are written by contracts/script/Deploy.s.sol — any chainId
// present in this directory is supported. Base Sepolia appears after a real
// testnet deploy; the app works fully with just 31337.json.
const modules = import.meta.glob("../deployments/*.json", { eager: true });
export const deployments: Record<number, Deployment> = {};
for (const [path, mod] of Object.entries(modules)) {
  const d = (mod as { default: Deployment }).default;
  const id = Number(path.match(/(\d+)\.json$/)?.[1]);
  if (id) deployments[id] = d;
}

export function deploymentFor(chainId: number): Deployment | undefined {
  return deployments[chainId];
}

export function chainFor(chainId: number): Chain {
  if (chainId === 84532) return baseSepolia;
  return anvilChain;
}

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${hash}`;
  return undefined;
}

export function explorerAddrUrl(chainId: number, addr: string): string | undefined {
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${addr}`;
  return undefined;
}

const clients = new Map<number, PublicClient>();

export function publicClientFor(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({
      chain: chainFor(chainId),
      transport: http(chainId === 84532 ? BASE_SEPOLIA_RPC : ANVIL_RPC),
    });
    clients.set(chainId, c);
  }
  return c;
}

export function isDemoChain(chainId: number): boolean {
  return chainId === 31337;
}

export function demoParam(): boolean {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}
