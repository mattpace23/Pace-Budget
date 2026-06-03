// GET /api/scoreboard?month=YYYY-MM
// Returns the full scoreboard for the requested month: per-category spending,
// monthly totals, and a cumulative savings balance computed across all months
// from the starting-balance date to the requested month.

import { json, badRequest, serverError } from "./../lib/db";
import {
  type CategoryRow,
  type MonthDelta,
  type ScoreboardData,
  appendUncategorizedStatus,
  buildCategoryStatus,
  computeCategorySpending,
  computeMonthDelta,
  enumerateMonths,
} from "./../lib/scoreboard";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const month = url.searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("month must be YYYY-MM");

  try {
    // Load all categories once.
    const { results: categories } = await ctx.env.DB.prepare(
      `SELECT id, name, amount, kind, sort_order, archived
         FROM categories ORDER BY sort_order ASC`,
    ).all<CategoryRow>();

    // Load settings (savings starting balance + date).
    const { results: settingRows } = await ctx.env.DB.prepare(
      `SELECT key, value FROM settings`,
    ).all<{ key: string; value: string }>();
    const settings: Record<string, string> = {};
    for (const s of settingRows) settings[s.key] = s.value;
    const startingBalanceCents = Number(
      settings.savings_starting_balance_cents ?? "0",
    );
    const startingAsOf = settings.savings_starting_as_of_iso ?? `${month}-01`;
    const startMonth = startingAsOf.substring(0, 7);

    // Closed-bucket savings transfers grouped by close month. We query these
    // before the delta loop so we can fold them into each month's savings
    // contribution.
    const { results: bucketCloseRows } = await ctx.env.DB.prepare(
      `SELECT
         strftime('%Y-%m', datetime(closed_at, 'unixepoch')) AS month,
         COALESCE(SUM(savings_transfer_cents), 0) AS total_cents
         FROM misc_income
        WHERE closed_at IS NOT NULL
          AND closed_disposition = 'savings'
          AND savings_transfer_cents > 0
        GROUP BY month`,
    ).all<{ month: string; total_cents: number }>();
    const bucketTransfersByMonth = new Map<string, number>();
    for (const r of bucketCloseRows) {
      bucketTransfersByMonth.set(r.month, r.total_cents);
    }

    // Compute the requested month's status. The Uncategorized synthetic row is
    // appended for visibility but is informational only (doesn't affect math).
    const spentMap = await computeCategorySpending(ctx.env.DB, month, categories);
    const byCategory = buildCategoryStatus(categories, spentMap);
    await appendUncategorizedStatus(ctx.env.DB, month, byCategory);
    const thisMonthDelta = computeMonthDelta(month, byCategory);
    applyBucketTransfer(thisMonthDelta, bucketTransfersByMonth.get(month) ?? 0);

    // Walk all months from start through current to build the cumulative
    // savings balance. Each month's delta also includes any closed-bucket
    // savings transfer that happened in that month.
    const months = enumerateMonths(startMonth, month);
    const priorDeltas: MonthDelta[] = [];
    let runningBalance = startingBalanceCents;
    for (const m of months) {
      if (m === month) continue;
      const s = await computeCategorySpending(ctx.env.DB, m, categories);
      const status = buildCategoryStatus(categories, s);
      await appendUncategorizedStatus(ctx.env.DB, m, status);
      const delta = computeMonthDelta(m, status);
      applyBucketTransfer(delta, bucketTransfersByMonth.get(m) ?? 0);
      priorDeltas.push(delta);
      runningBalance += delta.delta_cents;
    }
    const currentBalance = runningBalance + thisMonthDelta.delta_cents;

    // Aggregate this month's totals across real budget categories only.
    let budget_total_cents = 0;
    let spent_total_cents = 0;
    for (const c of byCategory) {
      if (c.id === -1) continue;
      if (c.kind === "income") continue;
      budget_total_cents += c.budget_cents;
      spent_total_cents += c.spent_cents;
    }
    const remaining_total_cents = budget_total_cents - spent_total_cents;

    // Cash flow: real money in vs real money out for the month. Excludes
    // transactions flagged as transfers — those are internal moves between the
    // user's own accounts (e.g. paying the Chase card from checking shows up
    // as a debit in checking AND a credit on the card; counting both would
    // double the totals).
    const cashFlowRow = await ctx.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents  ELSE 0 END), 0) AS expenses
         FROM transactions
        WHERE posted_at_iso LIKE ?
          AND is_transfer = 0`,
    )
      .bind(`${month}%`)
      .first<{ income: number; expenses: number }>();
    const total_income_cents = cashFlowRow?.income ?? 0;
    const total_expenses_cents = cashFlowRow?.expenses ?? 0;

    // Active misc-income buckets — only un-closed ones surface on the scoreboard.
    const { results: bucketRows } = await ctx.env.DB.prepare(
      `SELECT
         m.id, m.label, m.amount_cents, m.occurred_at_iso,
         COALESCE(SUM(CASE
               WHEN t.id IS NOT NULL AND t.id != IFNULL(m.source_tx_id, -1)
               THEN 1 ELSE 0
             END), 0) AS attached_count,
         COALESCE(SUM(CASE
               WHEN t.id IS NOT NULL AND t.id != IFNULL(m.source_tx_id, -1)
               THEN t.amount_cents ELSE 0
             END), 0) AS attached_total_cents
         FROM misc_income m
         LEFT JOIN transactions t ON t.misc_income_id = m.id
         WHERE m.closed_at IS NULL
         GROUP BY m.id
         ORDER BY m.occurred_at_iso DESC, m.id DESC`,
    ).all<{
      id: number;
      label: string;
      amount_cents: number;
      occurred_at_iso: string;
      attached_count: number;
      attached_total_cents: number;
    }>();
    const miscIncome = bucketRows.map((b) => ({
      ...b,
      remaining_cents: b.amount_cents - b.attached_total_cents,
    }));

    // Uncategorized count for the month.
    const counts = await ctx.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN is_transfer = 0 AND category_id IS NULL AND misc_income_id IS NULL
                       AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
                  THEN 1 ELSE 0 END) AS uncategorized
       FROM transactions t
       WHERE posted_at_iso LIKE ?`,
    )
      .bind(`${month}%`)
      .first<{ uncategorized: number }>();

    const out: ScoreboardData = {
      month,
      budget_total_cents,
      spent_total_cents,
      remaining_total_cents,
      total_income_cents,
      total_expenses_cents,
      by_category: byCategory,
      uncategorized_count: counts?.uncategorized ?? 0,
      misc_income: miscIncome,
      savings: {
        starting_balance_cents: startingBalanceCents,
        starting_as_of_iso: startingAsOf,
        current_balance_cents: currentBalance,
        this_month: thisMonthDelta,
        prior_month_deltas: priorDeltas,
      },
    };
    return json(out);
  } catch (e) {
    return serverError((e as Error).message);
  }
};

function applyBucketTransfer(delta: MonthDelta, transferCents: number): void {
  if (transferCents <= 0) return;
  delta.savings_contribution_cents += transferCents;
  delta.delta_cents = delta.savings_contribution_cents - delta.overspending_cents;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
