import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { baseSepolia } from "wagmi/chains";
import { anvilChain, ANVIL_RPC, BASE_SEPOLIA_RPC } from "./chains";

// Injected connector only — no WalletConnect projectId required.
export const wagmiConfig = createConfig({
  chains: [anvilChain, baseSepolia],
  connectors: [injected()],
  transports: {
    [anvilChain.id]: http(ANVIL_RPC),
    [baseSepolia.id]: http(BASE_SEPOLIA_RPC),
  },
});
