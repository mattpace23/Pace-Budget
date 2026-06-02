// GET  /api/misc-income          → list all buckets with summary (income, attached, remaining)
// POST /api/misc-income          → create a bucket from a source credit transaction

import { json, badRequest, serverError, toInt } from "../../lib/db";

interface Env {
  DB: D1Database;
}

interface MiscIncomeSummaryRow {
  id: number;
  label: string;
  amount_cents: number;
  occurred_at_iso: string;
  source_tx_id: number | null;
  notes: string | null;
  created_at: number;
  attached_count: number;
  attached_total_cents: number;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const url = new URL(ctx.request.url);
    const includeClosed = url.searchParams.get("includeClosed") === "1";

    // Each bucket + sum of attached debits (positive) and credits (negative).
    // Attached transactions exclude the bucket's own source_tx_id.
    // By default we only return active (un-closed) buckets.
    const sql = `
      SELECT
        m.id, m.label, m.amount_cents, m.occurred_at_iso, m.source_tx_id, m.notes, m.created_at,
        m.closed_at, m.closed_disposition, m.savings_transfer_cents,
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
      ${includeClosed ? "" : "WHERE m.closed_at IS NULL"}
      GROUP BY m.id
      ORDER BY m.occurred_at_iso DESC, m.id DESC
    `;
    const { results } = await ctx.env.DB.prepare(sql).all<MiscIncomeSummaryRow>();
    return json({
      misc_income: results.map((r) => ({
        ...r,
        remaining_cents: r.amount_cents - r.attached_total_cents,
      })),
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const transactionId = toInt(body.transaction_id);
  if (transactionId === null) return badRequest("transaction_id is required");

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return badRequest("label is required");

  const notes = typeof body.notes === "string" ? body.notes : null;

  try {
    // Load the transaction. Source must be a credit (amount_cents < 0).
    const tx = await ctx.env.DB.prepare(
      `SELECT id, amount_cents, posted_at_iso, misc_income_id
         FROM transactions WHERE id = ?`,
    )
      .bind(transactionId)
      .first<{
        id: number;
        amount_cents: number;
        posted_at_iso: string;
        misc_income_id: number | null;
      }>();
    if (!tx) return badRequest("unknown transaction_id");
    if (tx.amount_cents >= 0) {
      return badRequest("source transaction must be a credit (incoming money)");
    }
    if (tx.misc_income_id !== null) {
      return badRequest("transaction is already attached to a misc income bucket");
    }

    const incomeAmount = -tx.amount_cents; // store as positive cents

    // Insert bucket.
    const result = await ctx.env.DB.prepare(
      `INSERT INTO misc_income (label, amount_cents, occurred_at_iso, source_tx_id, notes)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(label, incomeAmount, tx.posted_at_iso, tx.id, notes)
      .run();

    const bucketId = Number(result.meta.last_row_id);

    // Mark the source transaction.
    await ctx.env.DB.prepare(
      `UPDATE transactions SET misc_income_id = ?, category_id = NULL, is_transfer = 0 WHERE id = ?`,
    )
      .bind(bucketId, tx.id)
      .run();

    const bucket = await ctx.env.DB.prepare(
      `SELECT id, label, amount_cents, occurred_at_iso, source_tx_id, notes, created_at
         FROM misc_income WHERE id = ?`,
    )
      .bind(bucketId)
      .first<MiscIncomeSummaryRow>();
    return json(
      {
        misc_income: {
          ...bucket,
          attached_count: 0,
          attached_total_cents: 0,
          remaining_cents: incomeAmount,
        },
      },
      201,
    );
  } catch (e) {
    return serverError((e as Error).message);
  }
};
