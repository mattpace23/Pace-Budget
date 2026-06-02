import { useEffect, useState } from "react";
import { api, type MiscIncomeBucket, type Transaction } from "../lib/api";
import { formatMoney } from "../lib/format";

export function MiscIncomeModal({
  transaction,
  onClose,
  onChanged,
}: {
  transaction: Transaction;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [buckets, setBuckets] = useState<MiscIncomeBucket[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCredit = transaction.amount_cents < 0;
  const absCents = Math.abs(transaction.amount_cents);
  const alreadyAttached = transaction.misc_income_id !== null;

  useEffect(() => {
    api
      .listMiscIncome()
      .then((r) => setBuckets(r.misc_income))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function createBucket() {
    if (!label.trim()) {
      setError("Please enter a label");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createMiscIncome({ transaction_id: transaction.id, label: label.trim() });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function attachToBucket(bucketId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.updateTransaction(transaction.id, { misc_income_id: bucketId });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    setBusy(true);
    setError(null);
    try {
      await api.updateTransaction(transaction.id, { misc_income_id: null });
      onChanged();
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
          <h3 className="text-lg font-semibold">Misc Income</h3>
          <p className="mt-1 text-sm text-muted">
            {transaction.description} ·{" "}
            <span className={isCredit ? "text-accent" : ""}>
              {isCredit ? "+" : ""}
              {formatMoney(absCents, { cents: true })}
            </span>
          </p>
        </div>

        {alreadyAttached && (
          <div className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
            Currently attached to <strong>{transaction.misc_income_label}</strong>.{" "}
            <button onClick={detach} disabled={busy} className="underline">
              detach
            </button>
          </div>
        )}

        {/* Create-from-credit section: only shown for credits */}
        {isCredit && !alreadyAttached && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Create a new bucket from this income
            </h4>
            <p className="text-xs text-muted">
              Future expenses can be attached to this bucket. They'll be absorbed
              by it and won't count against your regular budget.
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="e.g. Mom — iPads"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
              <button className="btn-primary" onClick={createBucket} disabled={busy || !label.trim()}>
                Create
              </button>
            </div>
          </section>
        )}

        {/* Attach-to-existing section: shown for debits and credits */}
        {!alreadyAttached && buckets !== null && buckets.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {isCredit ? "Or add this income to an existing bucket" : "Attach to a bucket"}
            </h4>
            <ul className="divide-y divide-ink/10">
              {buckets.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.label}</p>
                    <p className="text-xs text-muted">
                      {formatMoney(b.amount_cents, { cents: true })} bucket ·{" "}
                      <span
                        className={
                          b.remaining_cents < 0 ? "text-warn" : "text-accent"
                        }
                      >
                        {formatMoney(b.remaining_cents, { cents: true })} remaining
                      </span>
                    </p>
                  </div>
                  <button
                    className="btn-secondary whitespace-nowrap"
                    onClick={() => attachToBucket(b.id)}
                    disabled={busy}
                  >
                    Attach
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!alreadyAttached && !isCredit && buckets !== null && buckets.length === 0 && (
          <p className="text-sm text-muted">
            No misc income buckets yet. Create one by marking a credit transaction
            (like a Venmo from a family member) as Misc Income first.
          </p>
        )}

        {error && <p className="text-sm text-warn">{error}</p>}

        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
