// PUT    /api/transactions/:id/splits  → set splits (1-3 categories, must sum to amount)
// DELETE /api/transactions/:id/splits  → remove all splits

import { json, badRequest, notFound, serverError, toInt } from "../../../lib/db";

interface Env {
  DB: D1Database;
}

interface SplitInput {
  category_id?: unknown;
  amount_cents?: unknown;
}

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");

  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  if (!Array.isArray(body?.splits)) return badRequest("splits must be an array");
  if (body.splits.length < 1) return badRequest("must provide at least 1 split");
  if (body.splits.length > 3) return badRequest("max 3 splits per transaction");

  // Validate transaction exists, get its amount.
  const tx = await ctx.env.DB.prepare(
    `SELECT id, amount_cents FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; amount_cents: number }>();
  if (!tx) return notFound("transaction not found");

  // Validate splits.
  const splits: { category_id: number; amount_cents: number }[] = [];
  for (let i = 0; i < body.splits.length; i++) {
    const s = body.splits[i] as SplitInput;
    const cid = toInt(s.category_id);
    if (cid === null) return badRequest(`split ${i}: invalid category_id`);
    if (typeof s.amount_cents !== "number" || !Number.isFinite(s.amount_cents)) {
      return badRequest(`split ${i}: invalid amount_cents`);
    }
    // Splits inherit the sign convention of the transaction. A debit transaction
    // (+) gets split into positive parts; a credit (-) gets split into negative parts.
    if (tx.amount_cents > 0 && s.amount_cents <= 0) {
      return badRequest(`split ${i}: amount must be positive for a debit transaction`);
    }
    if (tx.amount_cents < 0 && s.amount_cents >= 0) {
      return badRequest(`split ${i}: amount must be negative for a credit transaction`);
    }
    splits.push({ category_id: cid, amount_cents: Math.trunc(s.amount_cents) });
  }

  const sumSplits = splits.reduce((sum, s) => sum + s.amount_cents, 0);
  if (sumSplits !== tx.amount_cents) {
    return badRequest(
      `splits must sum to transaction amount (${tx.amount_cents}); got ${sumSplits}`,
    );
  }

  // Validate categories exist.
  for (const s of splits) {
    const c = await ctx.env.DB.prepare(
      `SELECT id FROM categories WHERE id = ? AND archived = 0`,
    )
      .bind(s.category_id)
      .first<{ id: number }>();
    if (!c) return badRequest(`unknown or archived category_id: ${s.category_id}`);
  }

  try {
    // Replace splits atomically: delete existing, insert new. Also clear the
    // transaction's category_id (splits supersede it).
    const statements = [
      ctx.env.DB.prepare(`DELETE FROM transaction_splits WHERE transaction_id = ?`).bind(id),
      ctx.env.DB.prepare(`UPDATE transactions SET category_id = NULL, is_transfer = 0 WHERE id = ?`).bind(id),
      ...splits.map((s) =>
        ctx.env.DB.prepare(
          `INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)`,
        ).bind(id, s.category_id, s.amount_cents),
      ),
    ];
    await ctx.env.DB.batch(statements);
    return json({ ok: true, splits: splits.length });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");
  try {
    await ctx.env.DB.prepare(
      `DELETE FROM transaction_splits WHERE transaction_id = ?`,
    )
      .bind(id)
      .run();
    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
