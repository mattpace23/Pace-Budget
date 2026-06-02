import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Category,
  type ScoreboardData,
  type Transaction,
  type TransactionsResponse,
} from "../lib/api";
import { formatMoney } from "../lib/format";
import { SplitModal } from "../components/SplitModal";
import { Scoreboard } from "../components/Scoreboard";
import { MiscIncomeModal } from "../components/MiscIncomeModal";

type Filter = "all" | "uncategorized" | "categorized" | "transfer";

export default function Home() {
  const [month, setMonth] = useState<string>(currentMonthIso());
  const [filter, setFilter] = useState<Filter>("uncategorized");
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardData | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [splittingTx, setSplittingTx] = useState<Transaction | null>(null);
  const [miscIncomeTx, setMiscIncomeTx] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, cats, sb] = await Promise.all([
        api.listTransactions({ month, status: filter }),
        categories ? Promise.resolve({ categories }) : api.listCategories(),
        api.getScoreboard(month),
      ]);
      setData(tx);
      setScoreboard(sb);
      if (!categories) setCategories(cats.categories);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month, filter, categories]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCategoryChange(tx: Transaction, value: string) {
    setError(null);
    try {
      if (value === "transfer") {
        await api.updateTransaction(tx.id, { is_transfer: true });
      } else if (value === "") {
        await api.updateTransaction(tx.id, {
          category_id: null,
          is_transfer: false,
        });
      } else {
        await api.updateTransaction(tx.id, {
          category_id: Number(value),
          is_transfer: false,
        });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRescan() {
    setRescanning(true);
    setError(null);
    try {
      const r = await api.rescanTransactions();
      const parts: string[] = [];
      if (r.categorized > 0) parts.push(`${r.categorized} auto-categorized`);
      if (r.transferred > 0) parts.push(`${r.transferred} flagged as transfers`);
      setToast(
        parts.length > 0
          ? `Rescan: ${parts.join(", ")} (of ${r.scanned} unassigned).`
          : `Rescan: nothing new to auto-apply (${r.scanned} still need a category).`,
      );
      setTimeout(() => setToast(null), 5000);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRescanning(false);
    }
  }

  async function handleSaveSplit(
    tx: Transaction,
    splits: { category_id: number; amount_cents: number }[],
  ) {
    await api.setSplits(tx.id, splits);
    await refresh();
  }

  async function handleClearSplits(tx: Transaction) {
    if (!confirm("Remove the split? The transaction goes back to one category.")) return;
    try {
      await api.clearSplits(tx.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          {error}{" "}
          <button onClick={() => setError(null)} className="underline">
            dismiss
          </button>
        </div>
      )}

      {toast && (
        <div className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">
          {toast}
        </div>
      )}

      {scoreboard && <Scoreboard data={scoreboard} />}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted">
              Month
              <input
                type="month"
                className="input ml-2 inline-block w-auto"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            {data && (
              <span className="text-sm text-muted">
                {data.counts.total} transactions ·{" "}
                <span
                  className={
                    data.counts.uncategorized > 0
                      ? "font-semibold text-warn"
                      : "text-accent"
                  }
                >
                  {data.counts.uncategorized} to categorize
                </span>{" "}
                · {data.counts.transfers} transfers
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRescan}
              disabled={rescanning}
              className="btn-secondary text-sm"
              title="Re-run auto-categorization rules against everything uncategorized"
            >
              {rescanning ? "Rescanning…" : "Rescan"}
            </button>
            <Tabs filter={filter} onChange={setFilter} />
          </div>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-muted">Loading…</p>
      ) : !data || data.transactions.length === 0 ? (
        <div className="card text-muted">
          No transactions match this filter. Try a different month or filter.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-ink/10">
            {data.transactions.map((tx) => (
              <TransactionItem
                key={tx.id}
                tx={tx}
                categories={categories ?? []}
                onCategoryChange={handleCategoryChange}
                onOpenSplit={() => setSplittingTx(tx)}
                onClearSplits={handleClearSplits}
                onOpenMiscIncome={() => setMiscIncomeTx(tx)}
              />
            ))}
          </ul>
        </div>
      )}

      {splittingTx && categories && (
        <SplitModal
          transaction={splittingTx}
          categories={categories}
          onClose={() => setSplittingTx(null)}
          onSave={(splits) => handleSaveSplit(splittingTx, splits)}
        />
      )}

      {miscIncomeTx && (
        <MiscIncomeModal
          transaction={miscIncomeTx}
          onClose={() => setMiscIncomeTx(null)}
          onChanged={() => refresh()}
        />
      )}
    </div>
  );
}

function Tabs({
  filter,
  onChange,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
}) {
  const tabs: { id: Filter; label: string }[] = [
    { id: "uncategorized", label: "To do" },
    { id: "categorized", label: "Done" },
    { id: "transfer", label: "Transfers" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="flex flex-wrap gap-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            "rounded-md px-3 py-1.5",
            filter === t.id
              ? "bg-ink text-paper"
              : "text-muted hover:bg-ink/5 hover:text-ink",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TransactionItem({
  tx,
  categories,
  onCategoryChange,
  onOpenSplit,
  onClearSplits,
  onOpenMiscIncome,
}: {
  tx: Transaction;
  categories: Category[];
  onCategoryChange: (tx: Transaction, value: string) => void;
  onOpenSplit: () => void;
  onClearSplits: (tx: Transaction) => void;
  onOpenMiscIncome: () => void;
}) {
  const isCredit = tx.amount_cents < 0;
  const hasSplits = tx.splits.length > 0;
  const hasMiscIncome = tx.misc_income_id !== null;
  const isCategorized = hasSplits || tx.category_id !== null || tx.is_transfer || hasMiscIncome;

  // The visual treatment per the spec:
  //  - uncategorized → highlighted
  //  - categorized   → dulled
  const wrapperClass = useMemo(
    () =>
      isCategorized
        ? "px-4 py-3 opacity-60 hover:opacity-100"
        : "px-4 py-3 bg-amber-50/60 hover:bg-amber-50",
    [isCategorized],
  );

  return (
    <li className={wrapperClass}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted tabular-nums">{tx.posted_at_iso}</span>
            <span className="text-xs text-muted">{tx.account_name}</span>
            {tx.is_transfer && (
              <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink/70">
                Transfer
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium">{tx.description}</p>
          {hasSplits && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
              {tx.splits.map((s) => (
                <span
                  key={s.id}
                  className="rounded-md bg-ink/5 px-2 py-0.5"
                >
                  {s.category_name} · {formatMoney(Math.abs(s.amount_cents), { cents: true })}
                </span>
              ))}
              <button
                onClick={() => onClearSplits(tx)}
                className="text-muted underline hover:text-ink"
              >
                unsplit
              </button>
            </div>
          )}
          {hasMiscIncome && (
            <div className="mt-1 flex items-center gap-1 text-xs">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent">
                📥 {tx.misc_income_label}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          <span
            className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${
              isCredit ? "text-accent" : ""
            }`}
          >
            {isCredit ? "+" : ""}
            {formatMoney(Math.abs(tx.amount_cents), { cents: true })}
          </span>
          {!hasSplits && !hasMiscIncome && (
            <>
              {tx.suggested_category_id !== null && tx.category_id === null && !tx.is_transfer && (
                <button
                  className="whitespace-nowrap rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                  onClick={() => onCategoryChange(tx, String(tx.suggested_category_id))}
                  title="Apply the category you used last time for this merchant"
                >
                  ↳ {tx.suggested_category_name}
                </button>
              )}
              <select
                className="input w-full max-w-[180px] sm:w-auto"
                value={
                  tx.is_transfer
                    ? "transfer"
                    : tx.category_id !== null
                    ? String(tx.category_id)
                    : ""
                }
                onChange={(e) => onCategoryChange(tx, e.target.value)}
              >
                <option value="">— uncategorized —</option>
                <option value="transfer">Transfer (excluded)</option>
                <optgroup label="Categories">
                  {categories
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.kind === "savings" ? " ★" : ""}
                      </option>
                    ))}
                </optgroup>
              </select>
            </>
          )}
          {!hasSplits && (
            <button
              className="btn-secondary whitespace-nowrap"
              onClick={onOpenMiscIncome}
              title="Mark as misc income or attach to a misc income bucket"
            >
              {hasMiscIncome ? "📥 Edit" : "📥"}
            </button>
          )}
          <button
            className="btn-secondary whitespace-nowrap"
            onClick={onOpenSplit}
            title={hasSplits ? "Edit splits" : "Split into 2-3 categories"}
          >
            {hasSplits ? "Edit split" : "Split"}
          </button>
        </div>
      </div>
    </li>
  );
}

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
