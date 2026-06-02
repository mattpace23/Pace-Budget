// PATCH /api/transactions/:id
// Fields: category_id (number|null), is_transfer (boolean), notes (string|null),
//         misc_income_id (number|null)

import { json, badRequest, notFound, serverError, toInt } from "../../lib/db";
import { normalizeMerchantKey } from "../../lib/merchant";

interface Env {
  DB: D1Database;
}

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");

  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const updates: string[] = [];
  const bindings: (string | number | null)[] = [];

  if ("category_id" in body) {
    if (body.category_id === null) {
      updates.push("category_id = NULL");
    } else {
      const cid = toInt(body.category_id);
      if (cid === null) return badRequest("category_id must be a number or null");
      // Validate the category exists and isn't archived.
      const c = await ctx.env.DB.prepare(
        `SELECT id FROM categories WHERE id = ? AND archived = 0`,
      )
        .bind(cid)
        .first<{ id: number }>();
      if (!c) return badRequest("unknown or archived category_id");
      updates.push("category_id = ?");
      bindings.push(cid);
      // Picking a regular category detaches from any misc-income bucket.
      updates.push("misc_income_id = NULL");
    }
  }

  if ("is_transfer" in body) {
    updates.push("is_transfer = ?");
    bindings.push(body.is_transfer ? 1 : 0);
    // Marking as transfer also clears category and any misc-income attachment.
    if (body.is_transfer) {
      updates.push("category_id = NULL");
      updates.push("misc_income_id = NULL");
    }
  }

  if ("notes" in body) {
    if (body.notes === null) {
      updates.push("notes = NULL");
    } else if (typeof body.notes === "string") {
      updates.push("notes = ?");
      bindings.push(body.notes);
    } else {
      return badRequest("notes must be string or null");
    }
  }

  if ("misc_income_id" in body) {
    if (body.misc_income_id === null) {
      updates.push("misc_income_id = NULL");
    } else {
      const mid = toInt(body.misc_income_id);
      if (mid === null) return badRequest("misc_income_id must be a number or null");
      const m = await ctx.env.DB.prepare(
        `SELECT id FROM misc_income WHERE id = ?`,
      )
        .bind(mid)
        .first<{ id: number }>();
      if (!m) return badRequest("unknown misc_income_id");
      updates.push("misc_income_id = ?");
      bindings.push(mid);
      // Attaching to a misc-income bucket detaches from any category / transfer flag.
      updates.push("category_id = NULL");
      updates.push("is_transfer = 0");
    }
  }

  if (updates.length === 0) return badRequest("no fields to update");

  // Look up the transaction first — we need the description to learn the
  // merchant_memory mapping AND to propagate to other matching uncategorized rows.
  const tx = await ctx.env.DB.prepare(
    `SELECT id, description, category_id, is_transfer FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; description: string; category_id: number | null; is_transfer: number }>();
  if (!tx) return notFound();

  try {
    bindings.push(id);
    const sql = `UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`;
    const r = await ctx.env.DB.prepare(sql).bind(...bindings).run();
    if (r.meta.changes === 0) return notFound();

    // Record what was tagged in merchant_memory so future transactions for the
    // same merchant can offer it as a SUGGESTION. We do NOT propagate to other
    // transactions automatically — broad retailers (Sam's Club, Walmart) have
    // too much category variance per visit. The user always confirms.
    const settingCategory = "category_id" in body && body.category_id !== null;
    const settingTransfer = body.is_transfer === true;

    if (settingCategory) {
      const merchant_key = normalizeMerchantKey(tx.description);
      const category_id = toInt(body.category_id) as number;
      await ctx.env.DB.prepare(
        `INSERT INTO merchant_memory (merchant_key, category_id, is_transfer, hit_count, updated_at)
         VALUES (?, ?, 0, 1, unixepoch())
         ON CONFLICT(merchant_key) DO UPDATE SET
           category_id = excluded.category_id,
           is_transfer = 0,
           hit_count = merchant_memory.hit_count + 1,
           updated_at = unixepoch()`,
      )
        .bind(merchant_key, category_id)
        .run();
    } else if (settingTransfer) {
      const merchant_key = normalizeMerchantKey(tx.description);
      await ctx.env.DB.prepare(
        `INSERT INTO merchant_memory (merchant_key, category_id, is_transfer, hit_count, updated_at)
         VALUES (?, NULL, 1, 1, unixepoch())
         ON CONFLICT(merchant_key) DO UPDATE SET
           is_transfer = 1,
           hit_count = merchant_memory.hit_count + 1,
           updated_at = unixepoch()`,
      )
        .bind(merchant_key)
        .run();
    }

    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
