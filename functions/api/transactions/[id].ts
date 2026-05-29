// PATCH /api/transactions/:id
// Fields: category_id (number|null), is_transfer (boolean), notes (string|null),
//         misc_income_id (number|null)

import { json, badRequest, notFound, serverError, toInt } from "../../lib/db";

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
    }
  }

  if ("is_transfer" in body) {
    updates.push("is_transfer = ?");
    bindings.push(body.is_transfer ? 1 : 0);
    // Marking as transfer also clears category (a transfer has no spending category).
    if (body.is_transfer) {
      updates.push("category_id = NULL");
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
    }
  }

  if (updates.length === 0) return badRequest("no fields to update");

  try {
    bindings.push(id);
    const sql = `UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`;
    const r = await ctx.env.DB.prepare(sql).bind(...bindings).run();
    if (r.meta.changes === 0) return notFound();
    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
