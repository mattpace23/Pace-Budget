// GET /api/scoreboard?month=YYYY-MM
// Returns the full scoreboard for the requested month: per-category spending,
// monthly totals, and a cumulative savings balance computed across all months
// from the starting-balance date to the requested month.

import { json, badRequest, serverError } from "./../lib/db";
import {
  type CategoryRow,
  type CategoryStatus,
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

    // Compute the requested month's status. The Uncategorized synthetic row is
    // appended so anything still untagged counts as overspending (eats savings).
    const spentMap = await computeCategorySpending(ctx.env.DB, month, categories);
    const byCategory = buildCategoryStatus(categories, spentMap);
    await appendUncategorizedStatus(ctx.env.DB, month, byCategory);
    const thisMonthDelta = computeMonthDelta(month, byCategory);

    // Walk all months from start through current to build the cumulative
    // savings balance. The loop runs once per month — fine for any reasonable
    // budgeting horizon. Each month also includes its uncategorized total.
    const months = enumerateMonths(startMonth, month);
    const priorDeltas: MonthDelta[] = [];
    let runningBalance = startingBalanceCents;
    for (const m of months) {
      if (m === month) continue; // current month tallied separately below
      const s = await computeCategorySpending(ctx.env.DB, m, categories);
      const status = buildCategoryStatus(categories, s);
      await appendUncategorizedStatus(ctx.env.DB, m, status);
      const delta = computeMonthDelta(m, status);
      priorDeltas.push(delta);
      runningBalance += delta.delta_cents;
    }
    const currentBalance = runningBalance + thisMonthDelta.delta_cents;

    // Aggregate this month's totals across real budget categories only.
    // Income categories are excluded (income is tracked via cash flow below).
    // The synthetic Uncategorized line (id = -1) is also excluded — it's a
    // visibility nag, not budgeted spending.
    let budget_total_cents = 0;
    let spent_total_cents = 0;
    for (const c of byCategory) {
      if (c.id === -1) continue;
      if (c.kind === "income") continue;
      budget_total_cents += c.budget_cents;
      spent_total_cents += c.spent_cents;
    }
    const remaining_total_cents = budget_total_cents - spent_total_cents;

    // Cash flow: raw debits vs credits for the month, regardless of category
    // or transfer status. Gives a "money in vs money out" check independent
    // of the budget math.
    const cashFlowRow = await ctx.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents  ELSE 0 END), 0) AS expenses
         FROM transactions
        WHERE posted_at_iso LIKE ?`,
    )
      .bind(`${month}%`)
      .first<{ income: number; expenses: number }>();
    const total_income_cents = cashFlowRow?.income ?? 0;
    const total_expenses_cents = cashFlowRow?.expenses ?? 0;

    // Uncategorized count for the month.
    const counts = await ctx.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN is_transfer = 0 AND category_id IS NULL
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

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
