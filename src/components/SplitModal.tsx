import { useMemo, useState } from "react";
import type { Category, Transaction } from "../lib/api";
import { formatMoney, parseDollarsToCents } from "../lib/format";

type SplitRow = {
  category_id: number | "";
  amount: string; // dollars, as typed
};

export function SplitModal({
  transaction,
  categories,
  onClose,
  onSave,
}: {
  transaction: Transaction;
  categories: Category[];
  onClose: () => void;
  onSave: (
    splits: { category_id: number; amount_cents: number }[],
  ) => Promise<void>;
}) {
  const isDebit = transaction.amount_cents > 0;
  const totalAbsCents = Math.abs(transaction.amount_cents);

  // Initialize from existing splits if any, else two empty rows.
  const [rows, setRows] = useState<SplitRow[]>(() => {
    if (transaction.splits.length > 0) {
      return transaction.splits.map((s) => ({
        category_id: s.category_id,
        amount: (Math.abs(s.amount_cents) / 100).toFixed(2),
      }));
    }
    return [
      { category_id: "", amount: "" },
      { category_id: "", amount: "" },
    ];
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expense = categories.filter((c) => !c.archived);

  // Totals and balance check.
  const { sumAbs, balanced, lastSuggestion } = useMemo(() => {
    const cents = rows.map((r) => parseDollarsToCents(r.amount) ?? 0);
    const sumAbs = cents.reduce((s, n) => s + n, 0);
    const balanced = sumAbs === totalAbsCents;
    const sumOfFirstN = cents.slice(0, -1).reduce((s, n) => s + n, 0);
    const lastSuggestion =
      sumOfFirstN < totalAbsCents && rows.length > 1
        ? ((totalAbsCents - sumOfFirstN) / 100).toFixed(2)
        : null;
    return { sumAbs, balanced, lastSuggestion };
  }, [rows, totalAbsCents]);

  function addRow() {
    if (rows.length >= 3) return;
    setRows([...rows, { category_id: "", amount: "" }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, idx) => idx !== i));
  }

  function autoBalance() {
    if (lastSuggestion === null) return;
    setRows(rows.map((r, i) => (i === rows.length - 1 ? { ...r, amount: lastSuggestion } : r)));
  }

  async function save() {
    setError(null);
    // Validate.
    const out: { category_id: number; amount_cents: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.category_id === "") {
        setError(`Split ${i + 1}: pick a category`);
        return;
      }
      const cents = parseDollarsToCents(r.amount);
      if (cents === null || cents <= 0) {
        setError(`Split ${i + 1}: amount must be a positive number`);
        return;
      }
      // Apply transaction sign (we store with the same sign as the original tx).
      const signed = isDebit ? cents : -cents;
      out.push({ category_id: r.category_id as number, amount_cents: signed });
    }
    if (!balanced) {
      setError(`Splits must sum to ${formatMoney(totalAbsCents, { cents: true })}`);
      return;
    }
    setBusy(true);
    try {
      await onSave(out);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg space-y-4 rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">Split transaction</h3>
          <p className="mt-1 text-sm text-muted">
            {transaction.description} ·{" "}
            <span className={isDebit ? "" : "text-accent"}>
              {formatMoney(totalAbsCents, { cents: true })}
              {!isDebit && " in"}
            </span>
          </p>
        </div>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <select
                className="input"
                value={row.category_id}
                onChange={(e) =>
                  setRows(
                    rows.map((r, idx) =>
                      idx === i
                        ? { ...r, category_id: e.target.value === "" ? "" : Number(e.target.value) }
                        : r,
                    ),
                  )
                }
              >
                <option value="">Category…</option>
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={row.amount}
                onChange={(e) =>
                  setRows(
                    rows.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)),
                  )
                }
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                aria-label="Remove split"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            {rows.length < 3 && (
              <button type="button" className="text-accent underline" onClick={addRow}>
                + Add split
              </button>
            )}
          </div>
          <div className={balanced ? "text-muted" : "text-warn"}>
            Sum: {formatMoney(sumAbs, { cents: true })} /{" "}
            {formatMoney(totalAbsCents, { cents: true })}
            {!balanced && lastSuggestion !== null && (
              <button
                type="button"
                onClick={autoBalance}
                className="ml-2 underline"
                title={`Set last to ${lastSuggestion}`}
              >
                auto-balance
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-warn">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save split"}
          </button>
        </div>
      </div>
    </div>
  );
}
