// Scoreboard math. Computes per-category spending, overspending, and the
// cumulative savings balance for any month.
//
// Sign conventions:
//   transactions.amount_cents > 0  → money out (debit)
//   transactions.amount_cents < 0  → money in (credit / refund / income)
// "Spent in category X" therefore = SUM(amount_cents), which is positive for
// normal spending and reduced by refunds.

export interface CategoryRow {
  id: number;
  name: string;
  amount: number; // budget in cents
  kind: "expense" | "savings" | "income";
  sort_order: number;
  archived: number;
}

export interface CategoryStatus {
  id: number;
  name: string;
  kind: "expense" | "savings" | "income";
  budget_cents: number;
  spent_cents: number; // net (debits minus credits in same category)
  remaining_cents: number; // budget - spent (can be negative)
  over_cents: number; // max(0, spent - budget) for expense; 0 for income/savings
  sort_order: number;
}

export interface MonthDelta {
  month: string; // YYYY-MM
  savings_contribution_cents: number;
  overspending_cents: number;
  delta_cents: number; // contribution - overspending
}

export interface ScoreboardData {
  month: string;
  budget_total_cents: number; // sum of expense + savings categories
  spent_total_cents: number; // sum of all expense+savings category spending (excludes synthetic Uncategorized)
  remaining_total_cents: number;
  total_income_cents: number; // raw inflow this month (sum of all credits)
  total_expenses_cents: number; // raw outflow this month (sum of all debits)
  by_category: CategoryStatus[];
  uncategorized_count: number;
  savings: {
    starting_balance_cents: number;
    starting_as_of_iso: string;
    current_balance_cents: number; // starting + sum of all month deltas through requested month
    this_month: MonthDelta;
    prior_month_deltas: MonthDelta[];
  };
}

// Computes per-category spending for a single month.
export async function computeCategorySpending(
  db: D1Database,
  month: string, // YYYY-MM
  categories: CategoryRow[],
): Promise<Map<number, number>> {
  const spent = new Map<number, number>();

  // 1) Direct category assignments (transactions without splits).
  const { results: direct } = await db
    .prepare(
      `SELECT t.category_id, SUM(t.amount_cents) AS total
         FROM transactions t
        WHERE t.posted_at_iso LIKE ?
          AND t.is_transfer = 0
          AND t.category_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
        GROUP BY t.category_id`,
    )
    .bind(`${month}%`)
    .all<{ category_id: number; total: number }>();
  for (const r of direct) spent.set(r.category_id, (spent.get(r.category_id) ?? 0) + r.total);

  // 2) Split assignments.
  const { results: splits } = await db
    .prepare(
      `SELECT s.category_id, SUM(s.amount_cents) AS total
         FROM transaction_splits s
         JOIN transactions t ON t.id = s.transaction_id
        WHERE t.posted_at_iso LIKE ?
          AND t.is_transfer = 0
        GROUP BY s.category_id`,
    )
    .bind(`${month}%`)
    .all<{ category_id: number; total: number }>();
  for (const r of splits) spent.set(r.category_id, (spent.get(r.category_id) ?? 0) + r.total);

  // Ensure every category appears (with 0 if no activity).
  for (const c of categories) {
    if (!spent.has(c.id)) spent.set(c.id, 0);
  }
  return spent;
}

export function buildCategoryStatus(
  categories: CategoryRow[],
  spent: Map<number, number>,
): CategoryStatus[] {
  return categories
    .filter((c) => !c.archived)
    .map((c) => {
      const spent_cents = spent.get(c.id) ?? 0;
      const remaining_cents = c.amount - spent_cents;
      // Overspending only counts for expense categories (you can't "overspend" income).
      // Savings categories: under-contributing is its own concept handled by the
      // savings calculation, NOT counted as overspending here.
      const over_cents =
        c.kind === "expense" ? Math.max(0, spent_cents - c.amount) : 0;
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        budget_cents: c.amount,
        spent_cents,
        remaining_cents,
        over_cents,
        sort_order: c.sort_order,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

// Compute the savings delta for a single month.
// The synthetic Uncategorized line (id = -1) is informational only and excluded
// from both contribution and overspending totals — it doesn't represent real
// budget data, just a nag to categorize.
export function computeMonthDelta(
  month: string,
  byCategory: CategoryStatus[],
): MonthDelta {
  let savings_contribution_cents = 0;
  let overspending_cents = 0;
  for (const c of byCategory) {
    if (c.id === -1) continue; // synthetic Uncategorized — informational only
    if (c.kind === "savings") savings_contribution_cents += c.spent_cents;
    if (c.kind === "expense") overspending_cents += c.over_cents;
  }
  return {
    month,
    savings_contribution_cents,
    overspending_cents,
    delta_cents: savings_contribution_cents - overspending_cents,
  };
}

// Appends a synthetic "Uncategorized" line to the status list, summing every
// non-transfer transaction this month that has no category and no splits.
// budget = 0, so the entire amount counts as overspending (kind=expense).
// This makes the scoreboard honest: untagged transactions can't "hide" from
// the savings impact calculation.
//
// Uses id = -1 as a sentinel since real category IDs are positive.
export async function appendUncategorizedStatus(
  db: D1Database,
  month: string,
  status: CategoryStatus[],
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS row_count
         FROM transactions t
        WHERE posted_at_iso LIKE ?
          AND is_transfer = 0
          AND category_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`,
    )
    .bind(`${month}%`)
    .first<{ total: number; row_count: number }>();

  if (row && row.row_count > 0) {
    status.push({
      id: -1,
      name: "Uncategorized",
      kind: "expense",
      budget_cents: 0,
      spent_cents: row.total,
      remaining_cents: -row.total,
      over_cents: Math.max(0, row.total),
      sort_order: 5, // appear at top of expense section
    });
    status.sort((a, b) => a.sort_order - b.sort_order);
  }
}

// Enumerate months from startMonth (inclusive) to endMonth (inclusive).
// Both are YYYY-MM strings.
export function enumerateMonths(startMonth: string, endMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
