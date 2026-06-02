import { useMemo, useState } from "react";
import { api, type MiscIncomeSummary, type ScoreboardData } from "../lib/api";
import { formatMoney } from "../lib/format";

export function Scoreboard({
  data,
  onChanged,
}: {
  data: ScoreboardData;
  onChanged?: () => void;
}) {
  const remaining = data.remaining_total_cents;
  const overBudget = remaining < 0;
  const pctSpent = data.budget_total_cents > 0
    ? Math.min(100, (data.spent_total_cents / data.budget_total_cents) * 100)
    : 0;

  const sav = data.savings;
  const change = sav.this_month.delta_cents;
  const isGain = change >= 0;

  const expenseCategories = useMemo(
    () => data.by_category.filter((c) => c.kind === "expense"),
    [data.by_category],
  );
  const savingsCategories = useMemo(
    () => data.by_category.filter((c) => c.kind === "savings"),
    [data.by_category],
  );

  const netCashFlow = data.total_income_cents - data.total_expenses_cents;
  const isCashPositive = netCashFlow >= 0;

  return (
    <div className="space-y-4">
      {/* Top row: four cards. 2-col on tablet, 4-col on desktop. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreCard
          label="Spent vs budget this month"
          value={formatMoney(data.spent_total_cents)}
          sublabel={
            <>
              of {formatMoney(data.budget_total_cents)} ·{" "}
              <span className={overBudget ? "font-semibold text-warn" : "text-accent"}>
                {overBudget
                  ? `${formatMoney(Math.abs(remaining))} over`
                  : `${formatMoney(remaining)} left`}
              </span>
            </>
          }
          progressPct={pctSpent}
          progressColor={overBudget ? "warn" : "accent"}
        />
        <ScoreCard
          label="Savings balance"
          value={formatMoney(sav.current_balance_cents, { cents: true })}
          sublabel={
            <>
              This month{" "}
              <span className={isGain ? "text-accent" : "text-warn"}>
                {isGain ? "+" : ""}
                {formatMoney(change, { cents: true })}
              </span>{" "}
              <span className="text-muted">
                ({formatMoney(sav.this_month.savings_contribution_cents)} saved −{" "}
                {formatMoney(sav.this_month.overspending_cents)} overspent)
              </span>
            </>
          }
        />
        <ScoreCard
          label="Cash flow this month"
          value={`${isCashPositive ? "+" : ""}${formatMoney(netCashFlow)}`}
          sublabel={
            <>
              <span className="text-accent">+{formatMoney(data.total_income_cents)} in</span>{" "}
              · <span className="text-warn">−{formatMoney(data.total_expenses_cents)} out</span>
            </>
          }
          accentWhen={isCashPositive ? "accent" : "warn"}
        />
        <ScoreCard
          label="To categorize"
          value={String(data.uncategorized_count)}
          sublabel={
            data.uncategorized_count > 0 ? (
              <span className="text-warn">Some transactions still need a category.</span>
            ) : (
              <span className="text-accent">Everything's tagged. Nice.</span>
            )
          }
          accentWhen={data.uncategorized_count > 0 ? "warn" : "accent"}
        />
      </div>

      {/* Per-category breakdown */}
      <div className="card">
        <h3 className="text-sm font-semibold text-muted">By category</h3>
        <ul className="mt-3 space-y-2">
          {expenseCategories.map((c) => (
            <CategoryBar key={c.id} c={c} />
          ))}
          {savingsCategories.length > 0 && (
            <>
              <li className="pt-2 text-[10px] uppercase tracking-wide text-muted">
                Savings
              </li>
              {savingsCategories.map((c) => (
                <CategoryBar key={c.id} c={c} savings />
              ))}
            </>
          )}
        </ul>
      </div>

      {/* Misc Income buckets — extra income earmarked for specific things. */}
      {data.misc_income.length > 0 && (
        <MiscIncomeBucketsSection buckets={data.misc_income} onChanged={onChanged} />
      )}
    </div>
  );
}

function MiscIncomeBucketsSection({
  buckets,
  onChanged,
}: {
  buckets: MiscIncomeSummary[];
  onChanged?: () => void;
}) {
  const [closing, setClosing] = useState<MiscIncomeSummary | null>(null);

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-muted">Misc Income buckets</h3>
      <ul className="mt-3 divide-y divide-ink/10">
        {buckets.map((b) => {
          const usedPct = b.amount_cents > 0
            ? Math.min(100, (b.attached_total_cents / b.amount_cents) * 100)
            : 0;
          const overdrawn = b.remaining_cents < 0;
          return (
            <li key={b.id} className="grid items-center gap-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_14rem_auto]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">📥 {b.label}</p>
                <p className="text-xs text-muted">
                  {b.occurred_at_iso} · {b.attached_count} attached
                </p>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink/10">
                <div
                  className={`h-full ${overdrawn ? "bg-warn" : "bg-accent"}`}
                  style={{ width: `${overdrawn ? 100 : usedPct}%` }}
                />
              </div>
              <div className="text-right text-xs tabular-nums">
                <span className="text-muted">used </span>
                {formatMoney(b.attached_total_cents, { cents: true })}
                <span className="text-muted"> of {formatMoney(b.amount_cents, { cents: true })}</span>
                {" · "}
                <span className={overdrawn ? "font-semibold text-warn" : "text-accent"}>
                  {formatMoney(b.remaining_cents, { cents: true })} left
                </span>
              </div>
              <button
                className="btn-secondary text-xs"
                onClick={() => setClosing(b)}
                title="Close this bucket"
              >
                Close
              </button>
            </li>
          );
        })}
      </ul>
      {closing && (
        <CloseBucketModal
          bucket={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function CloseBucketModal({
  bucket,
  onClose,
  onClosed,
}: {
  bucket: MiscIncomeSummary;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [disposition, setDisposition] = useState<"savings" | "discard">("savings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = bucket.remaining_cents;
  const overdrawn = remaining < 0;
  const positive = remaining > 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.closeMiscIncome(bucket.id, positive ? disposition : "discard");
      onClosed();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md space-y-4 rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">Close bucket: {bucket.label}</h3>
          <p className="mt-1 text-sm text-muted">
            Bucket of {formatMoney(bucket.amount_cents, { cents: true })}; used{" "}
            {formatMoney(bucket.attached_total_cents, { cents: true })} ·{" "}
            <span className={overdrawn ? "text-warn" : "text-accent"}>
              {formatMoney(remaining, { cents: true })} remaining
            </span>
          </p>
        </div>

        {overdrawn && (
          <div className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
            This bucket is overdrawn by {formatMoney(-remaining, { cents: true })}.
            Find the attached transaction that should be split, split it so the
            overage goes to a real category, then close again.
          </div>
        )}

        {positive && !overdrawn && (
          <div className="space-y-2">
            <p className="text-sm">What should happen to the {formatMoney(remaining, { cents: true })} remaining?</p>
            <label className="flex items-start gap-2 rounded-lg border border-ink/15 p-3 cursor-pointer hover:bg-ink/5">
              <input
                type="radio"
                name="disposition"
                value="savings"
                checked={disposition === "savings"}
                onChange={() => setDisposition("savings")}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-medium">Transfer to savings</p>
                <p className="text-xs text-muted">
                  Counts as a {formatMoney(remaining, { cents: true })} savings contribution this month.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-ink/15 p-3 cursor-pointer hover:bg-ink/5">
              <input
                type="radio"
                name="disposition"
                value="discard"
                checked={disposition === "discard"}
                onChange={() => setDisposition("discard")}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-medium">Discard (no impact)</p>
                <p className="text-xs text-muted">
                  Just close it. The leftover money stays in your account but isn't tracked anywhere.
                </p>
              </div>
            </label>
          </div>
        )}

        {!overdrawn && remaining === 0 && (
          <p className="text-sm text-muted">
            This bucket is fully spent. Closing it just removes it from the active list.
          </p>
        )}

        {error && <p className="text-sm text-warn">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {!overdrawn && (
            <button className="btn-primary" onClick={confirm} disabled={busy}>
              {busy ? "Closing…" : "Close bucket"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  sublabel,
  progressPct,
  progressColor,
  accentWhen,
}: {
  label: string;
  value: string;
  sublabel: React.ReactNode;
  progressPct?: number;
  progressColor?: "accent" | "warn";
  accentWhen?: "accent" | "warn";
}) {
  const valueColor =
    accentWhen === "warn"
      ? "text-warn"
      : accentWhen === "accent"
      ? "text-accent"
      : "text-ink";
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{sublabel}</p>
      {typeof progressPct === "number" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
          <div
            className={`h-full ${
              progressColor === "warn" ? "bg-warn" : "bg-accent"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CategoryBar({ c, savings = false }: { c: import("../lib/api").CategoryStatus; savings?: boolean }) {
  const pct = c.budget_cents > 0
    ? Math.min(100, (c.spent_cents / c.budget_cents) * 100)
    : c.spent_cents > 0
    ? 100
    : 0;
  const over = c.over_cents > 0;
  const under = savings && c.spent_cents < c.budget_cents;
  const isSynthetic = c.id === -1; // the "Uncategorized" line

  return (
    <li className="grid items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_14rem]">
      <div className="flex items-baseline gap-2">
        <span
          className={`text-sm font-medium ${
            isSynthetic ? "italic text-warn" : ""
          }`}
          title={
            isSynthetic
              ? "Sum of every transaction this month still missing a category. Counts as overspending until tagged."
              : undefined
          }
        >
          {c.name}
          {isSynthetic && " ⚠"}
        </span>
        {savings && <span className="text-[10px] text-muted">★ savings</span>}
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full ${
            over ? "bg-warn" : savings ? "bg-accent" : "bg-ink"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs tabular-nums">
        <span className={over ? "font-semibold text-warn" : ""}>
          {formatMoney(c.spent_cents)}
        </span>{" "}
        <span className="text-muted">/ {formatMoney(c.budget_cents)}</span>
        {over && (
          <span className="ml-1 text-warn">+{formatMoney(c.over_cents)}</span>
        )}
        {under && c.budget_cents > 0 && (
          <span className="ml-1 text-muted">−{formatMoney(c.budget_cents - c.spent_cents)} short</span>
        )}
      </div>
    </li>
  );
}
