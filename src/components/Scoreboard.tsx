import { useMemo } from "react";
import type { ScoreboardData } from "../lib/api";
import { formatMoney } from "../lib/format";

export function Scoreboard({ data }: { data: ScoreboardData }) {
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

  return (
    <div className="space-y-4">
      {/* Top row: the three big numbers */}
      <div className="grid gap-3 sm:grid-cols-3">
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
