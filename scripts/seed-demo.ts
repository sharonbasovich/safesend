// SafeSend demo seed — local Anvil only (chainId 31337).
// Funds demo accounts, mints mUSDT, seeds a verified payee ("Terry") through the
// real escrow+claim path, and sets the demo cooldown to 60s.
//
// Run: npm run seed   (requires `anvil` running and `forge script Deploy.s.sol` already broadcast)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dir = dirname(fileURLToPath(import.meta.url));
const RPC = "http://127.0.0.1:8545";

const anvilChain = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

// Well-known Anvil dev accounts — public test keys, zero real value.
export const VICTIM_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const TERRY_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const ATTACKER_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const FRIEND_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

const victim = privateKeyToAccount(VICTIM_KEY);
const terry = privateKeyToAccount(TERRY_KEY);
const attacker = privateKeyToAccount(ATTACKER_KEY);
const friend = privateKeyToAccount(FRIEND_KEY);

// A deterministic lookalike of Terry: same first 4 and last 4 hex chars,
// different middle. No private key is needed — Anvil impersonation covers the
// dust leg of the attack, and zero-value transferFrom needs no allowance.
export const LOOKALIKE: Address = "0x7099deadbeefcafe1234567890abcdef012379c8";

const deployments = JSON.parse(
  readFileSync(join(__dir, "../web/src/deployments/31337.json"), "utf8")
) as { safeSend: Address; mockUSDT: Address; poisoner: Address; chainId: number };

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const routerAbi = parseAbi([
  "function send(address token, address to, uint128 amount) payable returns (uint256)",
  "function claim(uint256 id)",
  "function setCooldown(uint64 s)",
  "function verified(address,address) view returns (bool)",
  "function nextId() view returns (uint256)",
]);

const publicClient = createPublicClient({ chain: anvilChain, transport: http(RPC) });
const testClient = createTestClient({ chain: anvilChain, transport: http(RPC), mode: "anvil" });
const walletFor = (account: typeof victim) =>
  createWalletClient({ account, chain: anvilChain, transport: http(RPC) });

async function wait(hash: `0x${string}`) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}

const demoCooldown = 60n;

async function main() {
  const { safeSend, mockUSDT } = deployments;
  console.log("Seeding SafeSend demo on Anvil (31337)...");
  console.log("  router:", safeSend);
  console.log("  token :", mockUSDT);

  // 1. mint mUSDT to the demo actors
  for (const a of [victim, attacker, friend]) {
    await wait(
      await walletFor(victim).writeContract({
        address: mockUSDT,
        abi: tokenAbi,
        functionName: "mint",
        args: [a.address, 50_000_000_000n], // 50,000 mUSDT
      })
    );
  }
  console.log("  minted 50,000 mUSDT to victim, attacker, friend");

  // 2. victim approves the router and sets a 60s demo cooldown
  await wait(
    await walletFor(victim).writeContract({
      address: mockUSDT,
      abi: tokenAbi,
      functionName: "approve",
      args: [safeSend, 2n ** 256n - 1n],
    })
  );
  await wait(
    await walletFor(victim).writeContract({
      address: safeSend,
      abi: routerAbi,
      functionName: "setCooldown",
      args: [demoCooldown],
    })
  );
  console.log("  victim approved router; cooldown set to 60s");

  // 3. seed "Terry" as a verified payee through the real escrow + claim path
  const before = await publicClient.readContract({
    address: safeSend,
    abi: routerAbi,
    functionName: "nextId",
  });
  await wait(
    await walletFor(victim).writeContract({
      address: safeSend,
      abi: routerAbi,
      functionName: "send",
      args: [mockUSDT, terry.address, 100_000_000n], // 100 mUSDT
    })
  );
  await testClient.increaseTime({ seconds: Number(demoCooldown) + 1 });
  await testClient.mine({ blocks: 1 });
  await wait(
    await walletFor(terry).writeContract({
      address: safeSend,
      abi: routerAbi,
      functionName: "claim",
      args: [before],
    })
  );
  const ok = await publicClient.readContract({
    address: safeSend,
    abi: routerAbi,
    functionName: "verified",
    args: [victim.address, terry.address],
  });
  if (!ok) throw new Error("Terry was not verified by claim");
  console.log(`  Terry (${terry.address}) claimed escrow #${before} -> verified payee`);

  // 4. export demo accounts for the web app
  const demoAccounts = {
    victim: { label: "Victim (you)", address: victim.address, privateKey: VICTIM_KEY },
    terry: { label: "Terry (verified payee)", address: terry.address, privateKey: TERRY_KEY },
    attacker: { label: "Attacker", address: attacker.address, privateKey: ATTACKER_KEY },
    friend: { label: "New friend", address: friend.address, privateKey: FRIEND_KEY },
    lookalike: { label: "Lookalike of Terry", address: LOOKALIKE },
  };
  writeFileSync(
    join(__dir, "../web/src/demo-accounts.json"),
    JSON.stringify(demoAccounts, null, 2) + "\n"
  );
  console.log("  wrote web/src/demo-accounts.json");
  console.log("Done. Demo: send to the lookalike", LOOKALIKE, "and watch the 24h flag.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
