import { useApp } from "../lib/state";
import { explorerTxUrl } from "../lib/chains";

export function ToastStack() {
  const { toasts, chainId } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => {
        const url = t.hash ? explorerTxUrl(chainId, t.hash) : undefined;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg ${
              t.kind === "error"
                ? "border-red-800 bg-red-950/90 text-red-200"
                : t.kind === "success"
                  ? "border-emerald-800 bg-emerald-950/90 text-emerald-200"
                  : "border-zinc-700 bg-zinc-900/90 text-zinc-200"
            }`}
          >
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                {t.text}
              </a>
            ) : (
              t.text
            )}
          </div>
        );
      })}
    </div>
  );
}
