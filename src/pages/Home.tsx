import { useEffect, useState } from "react";

type Health = { ok: boolean; db?: string; now?: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health", { credentials: "include" })
  .then((r) => r.json())
  .then((data) => setHealth(data as Health))
      .catch(() => setHealth({ ok: false }));
  }, []);

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-lg font-semibold">You're in.</h2>
        <p className="mt-1 text-sm text-muted">
          This is the Phase 1 hello-world. We'll build the scoreboard, transactions
          list, and categorization here in the next phases.
        </p>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-muted">System check</h3>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/5 p-3 text-xs">
{health ? JSON.stringify(health, null, 2) : "Checking…"}
        </pre>
      </div>
    </div>
  );
}
