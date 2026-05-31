// GET /api/transactions?month=YYYY-MM[&account_id=N][&status=uncategorized|categorized|transfer|all]
// Returns transactions in the requested month with joined category info and splits.

import { json, badRequest, serverError, toInt } from "../../lib/db";
import { normalizeMerchantKey } from "../../lib/merchant";

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

    // For uncategorized non-transfer transactions, look up a suggestion from
    // merchant_memory (suggestion-only — the UI shows it but doesn't apply it).
    // We batch all unique merchant_keys into one IN-list query.
    const needsSuggestion = txs.filter(
      (t) => !t.is_transfer && t.category_id === null,
    );
    const keyByTxId = new Map<number, string>();
    const uniqueKeys = new Set<string>();
    for (const t of needsSuggestion) {
      const k = normalizeMerchantKey(t.description);
      keyByTxId.set(t.id, k);
      uniqueKeys.add(k);
    }

    const suggestionByKey = new Map<
      string,
      { category_id: number; category_name: string }
    >();
    if (uniqueKeys.size > 0) {
      const placeholders = Array.from(uniqueKeys).map(() => "?").join(",");
      const memSql = `
        SELECT m.merchant_key, m.category_id, c.name AS category_name
          FROM merchant_memory m
          JOIN categories c ON c.id = m.category_id
         WHERE m.is_transfer = 0
           AND c.archived = 0
           AND m.merchant_key IN (${placeholders})
      `;
      const { results: mems } = await ctx.env.DB.prepare(memSql)
        .bind(...Array.from(uniqueKeys))
        .all<{ merchant_key: string; category_id: number; category_name: string }>();
      for (const m of mems) {
        suggestionByKey.set(m.merchant_key, {
          category_id: m.category_id,
          category_name: m.category_name,
        });
      }
    }

    return json({
      month,
      counts: counts ?? { total: 0, uncategorized: 0, transfers: 0 },
      transactions: txs.map((t) => {
        const suggestion = keyByTxId.has(t.id)
          ? suggestionByKey.get(keyByTxId.get(t.id)!) ?? null
          : null;
        return {
          ...t,
          is_transfer: t.is_transfer === 1,
          splits: splitsByTx.get(t.id) ?? [],
          suggested_category_id: suggestion?.category_id ?? null,
          suggested_category_name: suggestion?.category_name ?? null,
        };
      }),
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
