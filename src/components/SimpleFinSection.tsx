import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";

type Status = Awaited<ReturnType<typeof api.simplefinStatus>>;

export function SimpleFinSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.simplefinStatus();
      setStatus(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function configure() {
    if (!tokenInput.trim()) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // Heuristic: if it looks like a bridge URL with auth, treat as access URL.
      const input = tokenInput.trim();
      const isAccessUrl = /^https:\/\/[^@\s]+:[^@\s]+@/.test(input);
      await api.simplefinConfigure(
        isAccessUrl ? { access_url: input } : { setup_token: input },
      );
      setTokenInput("");
      setInfo("SimpleFin configured. Map your accounts below to start syncing.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setMapping(accountId: number, remoteId: string) {
    setError(null);
    try {
      await api.simplefinMap(accountId, remoteId || null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await api.simplefinSync();
      setInfo(
        r.new_transactions > 0
          ? `Pulled ${r.new_transactions} new transactions across ${r.synced_accounts} account${r.synced_accounts === 1 ? "" : "s"}.`
          : `Sync complete. No new transactions.${r.warning ? " " + r.warning : ""}`,
      );
      if (r.errors.length > 0) {
        setError(r.errors.slice(0, 3).join("; "));
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold">SimpleFin daily sync</h2>
        <p className="mt-1 text-sm text-muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">SimpleFin daily sync</h2>
        <p className="mt-1 text-sm text-muted">
          Pulls new transactions automatically. Stop CSV-uploading any account
          mapped here — SimpleFin will keep it updated.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          {error}{" "}
          <button onClick={() => setError(null)} className="underline">
            dismiss
          </button>
        </div>
      )}
      {info && (
        <div className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {info}
        </div>
      )}

      {!status.configured ? (
        <div className="space-y-2">
          <p className="text-sm">
            Paste the <strong>setup token</strong> from SimpleFin (the one-time
            string) — or the permanent <strong>access URL</strong> if you've
            already exchanged it.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1"
              type="password"
              autoComplete="off"
              placeholder="setup token or access URL…"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={configure}
              disabled={busy || !tokenInput.trim()}
            >
              {busy ? "Configuring…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {status.fetch_error && (
            <div className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
              Couldn't talk to SimpleFin: {status.fetch_error}
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-muted">Account mapping</h3>
            <p className="mt-0.5 text-xs text-muted">
              Pick which SimpleFin account corresponds to each Pace Budget
              account. Unmapped accounts won't sync.
            </p>
            <ul className="mt-3 divide-y divide-ink/10">
              {status.local_accounts.map((local) => (
                <li
                  key={local.id}
                  className="grid items-center gap-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem]"
                >
                  <div className="text-sm font-medium">{local.name}</div>
                  <select
                    className="input"
                    value={local.simplefin_account_id ?? ""}
                    onChange={(e) => setMapping(local.id, e.target.value)}
                  >
                    <option value="">— not synced —</option>
                    {status.remote_accounts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.org} · {r.name} ({formatMoney(Math.round(parseFloat(r.balance) * 100), { cents: true })})
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-muted">
                    {local.simplefin_last_sync_at
                      ? `last sync ${formatRelative(local.simplefin_last_sync_at)}`
                      : "never synced"}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={syncNow} disabled={busy}>
              {busy ? "Syncing…" : "Sync now"}
            </button>
            <p className="text-xs text-muted">
              Or set up a free daily cron via the instructions below.
            </p>
          </div>

          <CronSetupInstructions />
        </>
      )}
    </section>
  );
}

function CronSetupInstructions() {
  return (
    <details className="rounded-lg ring-1 ring-ink/10 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Set up a free daily cron (recommended)
      </summary>
      <div className="mt-3 space-y-2 text-sm text-muted">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Generate a random secret (any password manager will make one ≥ 16
            chars; e.g.{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">
              5J!9rTpQz#8nXmGv&amp;e1H
            </code>
            ).
          </li>
          <li>
            On the <strong>Cloudflare dashboard</strong> → your Pages project →
            Settings → Environment variables, add an{" "}
            <strong>encrypted</strong> setting <code>SIMPLEFIN_CRON_SECRET</code>{" "}
            with that value, then redeploy.{" "}
            <em>
              (Or paste it into the cron_secret setting via API — but env-var
              is the secure path.)
            </em>
          </li>
          <li>
            Sign up free at{" "}
            <a
              href="https://cron-job.org"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              cron-job.org
            </a>
            .
          </li>
          <li>
            Create a job that hits{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">
              POST https://&lt;your-site&gt;.pages.dev/api/simplefin/sync?secret=YOUR_SECRET
            </code>{" "}
            once a day at the time you want (e.g., 8:00 Central).
          </li>
        </ol>
        <p className="text-xs">
          The shared secret bypasses the normal password gate just for the cron
          endpoint. Keep it private.
        </p>
      </div>
    </details>
  );
}

function formatRelative(epoch: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - epoch;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
