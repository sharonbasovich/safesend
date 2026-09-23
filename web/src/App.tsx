import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useApp } from "./lib/state";
import { DEMO_ACCOUNTS } from "./lib/demo";
import { AddressView } from "./components/AddressView";
import { ToastStack } from "./components/Toasts";
import { SendPage } from "./pages/Send";
import { PendingPage } from "./pages/Pending";
import { PayeesPage } from "./pages/Payees";
import { HistoryPage } from "./pages/History";
import { AttackerPage } from "./pages/Attacker";

const PAGES = [
  { id: "send", label: "Send" },
  { id: "pending", label: "Pending" },
  { id: "payees", label: "Payees" },
  { id: "history", label: "History" },
  { id: "attacker", label: "Attacker" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

export default function App() {
  const { demoMode, demoAccount, setDemoAccount, chainId } = useApp();
  const account = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [page, setPage] = useState<PageId>("send");

  const visiblePages = PAGES.filter((p) => p.id !== "attacker" || demoMode);

  return (
    <div className="min-h-screen">
      <div className="border-b border-amber-800/60 bg-amber-950/40 px-4 py-1.5 text-center text-xs text-amber-300">
        UNAUDITED TESTNET PROTOTYPE — demo assets only. Do not use with real funds.
      </div>

      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            SafeSend <span className="text-sm font-normal text-zinc-500">poison-aware payment router</span>
          </h1>
          <p className="text-xs text-zinc-500">chain {chainId} · no owner · no fees · immutable</p>
        </div>

        <div className="flex items-center gap-3">
          {demoMode ? (
            <select
              value={demoAccount.id}
              onChange={(e) => setDemoAccount(DEMO_ACCOUNTS.find((a) => a.id === e.target.value)!)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            >
              {DEMO_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.address.slice(0, 8)}…{a.address.slice(-4)}
                </option>
              ))}
            </select>
          ) : account.address ? (
            <div className="flex items-center gap-2">
              <AddressView address={account.address} />
              <button
                onClick={() => disconnect()}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <nav className="mx-auto flex max-w-5xl gap-1 border-b border-zinc-800 px-4">
        {visiblePages.map((p) => (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium ${
              page === p.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <main className="px-4 py-6">
        {page === "send" && <SendPage />}
        {page === "pending" && <PendingPage />}
        {page === "payees" && <PayeesPage />}
        {page === "history" && <HistoryPage />}
        {page === "attacker" && demoMode && <AttackerPage />}
      </main>

      <ToastStack />
    </div>
  );
}
