// GET /api/transactions?month=YYYY-MM[&account_id=N][&status=uncategorized|categorized|transfer|all]
// Returns transactions in the requested month with joined category info and splits.

import { json, badRequest, serverError, toInt } from "../../lib/db";

interface Env {
  DB: D1Database;
}

interface TxRow {
  id: number;
  account_id: number;
  account_name: string;
  posted_at_iso: string;
  description: string;
  amount_cents: number;
  raw_classification: string | null;
  is_transfer: number;
  category_id: number | null;
  category_name: string | null;
  misc_income_id: number | null;
  notes: string | null;
  dedup_ordinal: number;
  created_at: number;
}

interface SplitRow {
  id: number;
  transaction_id: number;
  category_id: number;
  category_name: string;
  amount_cents: number;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const month = url.searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("month must be YYYY-MM");

  const accountId = url.searchParams.get("account_id")
    ? toInt(url.searchParams.get("account_id"))
    : null;
  const status = url.searchParams.get("status") || "all";

  const filters: string[] = [`t.posted_at_iso LIKE ?`];
  const bindings: (string | number)[] = [`${month}%`];

  if (accountId !== null) {
    filters.push(`t.account_id = ?`);
    bindings.push(accountId);
  }

  if (status === "uncategorized") {
    // Uncategorized = not a transfer, no category, no splits.
    filters.push(
      `t.is_transfer = 0 AND t.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`,
    );
  } else if (status === "categorized") {
    filters.push(
      `(t.category_id IS NOT NULL OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id))`,
    );
  } else if (status === "transfer") {
    filters.push(`t.is_transfer = 1`);
  }

  const sql = `
    SELECT
      t.id, t.account_id, a.name AS account_name,
      t.posted_at_iso, t.description, t.amount_cents, t.raw_classification,
      t.is_transfer, t.category_id, c.name AS category_name,
      t.misc_income_id, t.notes, t.dedup_ordinal, t.created_at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${filters.join(" AND ")}
    ORDER BY t.posted_at_iso DESC, t.id DESC
  `;

  try {
    const { results: txs } = await ctx.env.DB.prepare(sql)
      .bind(...bindings)
      .all<TxRow>();

    // Fetch splits for the same month + filters in one query.
    const splitSql = `
      SELECT s.id, s.transaction_id, s.category_id, c.name AS category_name, s.amount_cents
      FROM transaction_splits s
      JOIN transactions t ON t.id = s.transaction_id
      JOIN categories c ON c.id = s.category_id
      WHERE t.posted_at_iso LIKE ?
      ORDER BY s.id ASC
    `;
    const { results: splits } = await ctx.env.DB.prepare(splitSql)
      .bind(`${month}%`)
      .all<SplitRow>();

    const splitsByTx = new Map<number, SplitRow[]>();
    for (const s of splits) {
      const arr = splitsByTx.get(s.transaction_id) ?? [];
      arr.push(s);
      splitsByTx.set(s.transaction_id, arr);
    }

    // Summary counts for the scoreboard nag.
    const counts = await ctx.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_transfer = 0 AND category_id IS NULL
                       AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
                  THEN 1 ELSE 0 END) AS uncategorized,
         SUM(CASE WHEN is_transfer = 1 THEN 1 ELSE 0 END) AS transfers
       FROM transactions t
       WHERE posted_at_iso LIKE ?`,
    )
      .bind(`${month}%`)
      .first<{ total: number; uncategorized: number; transfers: number }>();

    return json({
      month,
      counts: counts ?? { total: 0, uncategorized: 0, transfers: 0 },
      transactions: txs.map((t) => ({
        ...t,
        is_transfer: t.is_transfer === 1,
        splits: splitsByTx.get(t.id) ?? [],
      })),
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
