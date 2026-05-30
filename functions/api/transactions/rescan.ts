// POST /api/transactions/rescan
// Re-runs auto-categorization (hardcoded rules + merchant_memory) against every
// currently uncategorized, non-transfer, non-split transaction. Returns counts.

import { json, serverError } from "../../lib/db";
import { autoApply } from "../../lib/merchant";

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const { results } = await ctx.env.DB.prepare(
      `SELECT t.id, t.description
         FROM transactions t
        WHERE t.is_transfer = 0
          AND t.category_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`,
    ).all<{ id: number; description: string }>();

    let categorized = 0;
    let transferred = 0;
    const categoryCache = new Map<string, number | null>();
    const statements: D1PreparedStatement[] = [];

    for (const row of results) {
      const auto = await autoApply(ctx.env.DB, row.description, categoryCache);
      if (auto.is_transfer === 1) {
        statements.push(
          ctx.env.DB.prepare(
            `UPDATE transactions SET is_transfer = 1, category_id = NULL WHERE id = ?`,
          ).bind(row.id),
        );
        transferred++;
      } else if (auto.category_id !== null) {
        statements.push(
          ctx.env.DB.prepare(
            `UPDATE transactions SET category_id = ?, is_transfer = 0 WHERE id = ?`,
          ).bind(auto.category_id, row.id),
        );
        categorized++;
      }
    }

    // Apply in chunks.
    const CHUNK = 50;
    for (let i = 0; i < statements.length; i += CHUNK) {
      await ctx.env.DB.batch(statements.slice(i, i + CHUNK));
    }

    return json({
      ok: true,
      scanned: results.length,
      categorized,
      transferred,
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
