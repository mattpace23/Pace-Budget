import { useEffect, useMemo, useState } from "react";
import { api, type Account, type Upload } from "../lib/api";
import { parseByParserId, type ParsedRow } from "../lib/parsers";
import { formatMoney } from "../lib/format";

type ParseState =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "parsed"; filename: string; rows: ParsedRow[]; warnings: string[] }
  | { kind: "error"; message: string; details?: string[] };

export default function UploadPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [parseState, setParseState] = useState<ParseState>({ kind: "idle" });
  const [ingesting, setIngesting] = useState(false);
  const [lastResult, setLastResult] = useState<Upload | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listAccounts(), api.listUploads()])
      .then(([a, u]) => {
        setAccounts(a.accounts);
        setUploads(u.uploads);
        if (a.accounts.length > 0) setAccountId(a.accounts[0].id);
      })
      .catch((e: Error) => setTopError(e.message));
  }, []);

  const selectedAccount = useMemo(
    () => accounts?.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  async function handleFile(file: File) {
    if (!selectedAccount) return;
    setParseState({ kind: "parsing" });
    setLastResult(null);
    try {
      const text = await file.text();
      const result = parseByParserId(selectedAccount.parser, text);
      if (!result.ok) {
        setParseState({ kind: "error", message: result.error, details: result.details });
      } else if (result.rows.length === 0) {
        setParseState({
          kind: "error",
          message: "Parsed successfully but found 0 valid rows.",
          details: result.warnings,
        });
      } else {
        setParseState({
          kind: "parsed",
          filename: file.name,
          rows: result.rows,
          warnings: result.warnings,
        });
      }
    } catch (e) {
      setParseState({ kind: "error", message: (e as Error).message });
    }
  }

  async function handleIngest() {
    if (parseState.kind !== "parsed" || !selectedAccount) return;
    setIngesting(true);
    setTopError(null);
    try {
      const r = await api.createUpload({
        account_id: selectedAccount.id,
        filename: parseState.filename,
        rows: parseState.rows,
      });
      setLastResult(r.upload);
      setParseState({ kind: "idle" });
      const u = await api.listUploads();
      setUploads(u.uploads);
    } catch (e) {
      setTopError((e as Error).message);
    } finally {
      setIngesting(false);
    }
  }

  if (!accounts || !uploads) {
    return <div className="text-muted">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {topError && (
        <div className="rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          {topError}{" "}
          <button onClick={() => setTopError(null)} className="underline">
            dismiss
          </button>
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">
          Uploaded <strong>{lastResult.filename}</strong> —{" "}
          {lastResult.rows_inserted} new transactions,{" "}
          {lastResult.rows_duplicated} duplicates skipped.
        </div>
      )}

      <section className="card">
        <h2 className="text-lg font-semibold">Upload a CSV</h2>
        <p className="mt-1 text-sm text-muted">
          Select the source account, then pick the CSV file you downloaded. Duplicates
          (same account + date + amount + description) are skipped automatically.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr] sm:items-end">
          <label className="block text-sm">
            <span className="text-muted">Account</span>
            <select
              className="input mt-1"
              value={accountId ?? ""}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">CSV file</span>
            <input
              className="input mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:text-paper hover:file:bg-ink/90"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
          </label>
        </div>

        {parseState.kind === "parsing" && (
          <p className="mt-4 text-sm text-muted">Parsing…</p>
        )}

        {parseState.kind === "error" && (
          <div className="mt-4 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
            <p className="font-medium">{parseState.message}</p>
            {parseState.details && parseState.details.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {parseState.details.slice(0, 8).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
                {parseState.details.length > 8 && (
                  <li>… and {parseState.details.length - 8} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        {parseState.kind === "parsed" && (
          <ParsedPreview
            filename={parseState.filename}
            rows={parseState.rows}
            warnings={parseState.warnings}
            ingesting={ingesting}
            onConfirm={handleIngest}
            onCancel={() => setParseState({ kind: "idle" })}
          />
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Uploads so far</h2>
        {uploads.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nothing uploaded yet.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 pr-3 font-medium">When</th>
                <th className="pb-2 pr-3 font-medium">Account</th>
                <th className="pb-2 pr-3 font-medium">File</th>
                <th className="pb-2 pr-3 font-medium">Range</th>
                <th className="pb-2 pr-3 text-right font-medium">New</th>
                <th className="pb-2 pl-3 text-right font-medium">Dup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3 text-muted">
                    {formatUploadTime(u.uploaded_at)}
                  </td>
                  <td className="py-2 pr-3">{u.account_name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{u.filename}</td>
                  <td className="py-2 pr-3 text-muted">
                    {u.earliest_date_iso} → {u.latest_date_iso}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.rows_inserted}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted">
                    {u.rows_duplicated}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ParsedPreview({
  filename,
  rows,
  warnings,
  ingesting,
  onConfirm,
  onCancel,
}: {
  filename: string;
  rows: ParsedRow[];
  warnings: string[];
  ingesting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const totals = useMemo(() => {
    let debits = 0;
    let credits = 0;
    for (const r of rows) {
      if (r.amount_cents > 0) debits += r.amount_cents;
      else credits += -r.amount_cents;
    }
    return { debits, credits };
  }, [rows]);

  const earliest = rows.reduce(
    (acc, r) => (r.posted_at_iso < acc ? r.posted_at_iso : acc),
    rows[0].posted_at_iso,
  );
  const latest = rows.reduce(
    (acc, r) => (r.posted_at_iso > acc ? r.posted_at_iso : acc),
    rows[0].posted_at_iso,
  );

  const preview = rows.slice(0, 10);

  return (
    <div className="mt-4 rounded-lg ring-1 ring-ink/10 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium">{filename}</p>
          <p className="text-sm text-muted">
            {rows.length} rows · {earliest} → {latest} · debits{" "}
            {formatMoney(totals.debits)} · credits {formatMoney(totals.credits)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={ingesting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onConfirm} disabled={ingesting}>
            {ingesting ? "Uploading…" : `Ingest ${rows.length} rows`}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-warn">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"} (rows skipped)
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs text-warn">
            {warnings.slice(0, 12).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {warnings.length > 12 && <li>… and {warnings.length - 12} more</li>}
          </ul>
        </details>
      )}

      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="pb-2 pr-3 font-medium">Date</th>
            <th className="pb-2 pr-3 font-medium">Description</th>
            <th className="pb-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {preview.map((r, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 text-muted">{r.posted_at_iso}</td>
              <td className="py-1.5 pr-3">{r.description}</td>
              <td
                className={`py-1.5 pl-3 text-right tabular-nums ${
                  r.amount_cents < 0 ? "text-accent" : ""
                }`}
              >
                {formatMoney(Math.abs(r.amount_cents), { cents: true })}
                {r.amount_cents < 0 ? " in" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > preview.length && (
        <p className="mt-2 text-xs text-muted">
          Preview of first {preview.length} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}

function formatUploadTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
