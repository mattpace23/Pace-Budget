// POST /api/misc-income/:id/close   { disposition: 'savings' | 'discard' }
// Marks a bucket as closed. Behavior depends on remaining balance:
//   - overdrawn  → 400 (split the offending transaction first)
//   - balanced   → close, no savings impact
//   - positive   → close; if disposition='savings', remaining counts as a savings contribution
//                  in the month the close happened; if 'discard', no impact.

import { json, badRequest, notFound, serverError, toInt } from "../../../lib/db";

interface Env {
  DB: D1Database;
}

interface BucketRow {
  id: number;
  amount_cents: number;
  source_tx_id: number | null;
  closed_at: number | null;
  label: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");

  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  if (body.disposition !== "savings" && body.disposition !== "discard") {
    return badRequest("disposition must be 'savings' or 'discard'");
  }

  try {
    const bucket = await ctx.env.DB.prepare(
      `SELECT id, amount_cents, source_tx_id, closed_at, label FROM misc_income WHERE id = ?`,
    )
      .bind(id)
      .first<BucketRow>();
    if (!bucket) return notFound();
    if (bucket.closed_at !== null) {
      return badRequest("bucket is already closed");
    }

    // Compute current remaining balance.
    const attachedRow = await ctx.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM transactions
        WHERE misc_income_id = ?
          AND id != IFNULL(?, -1)`,
    )
      .bind(id, bucket.source_tx_id)
      .first<{ total: number }>();
    const attached_total = attachedRow?.total ?? 0;
    const remaining = bucket.amount_cents - attached_total;

    if (remaining < 0) {
      return badRequest(
        `bucket is overdrawn by ${centsToDollarStr(-remaining)}. Split one of the attached transactions so the overage goes to a regular category, then try closing again.`,
      );
    }

    const savings_transfer = body.disposition === "savings" ? Math.max(0, remaining) : 0;

    await ctx.env.DB.prepare(
      `UPDATE misc_income
          SET closed_at = unixepoch(),
              closed_disposition = ?,
              savings_transfer_cents = ?
        WHERE id = ?`,
    )
      .bind(body.disposition, savings_transfer, id)
      .run();

    return json({
      ok: true,
      closed: true,
      disposition: body.disposition,
      remaining_cents: remaining,
      savings_transfer_cents: savings_transfer,
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

function centsToDollarStr(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
