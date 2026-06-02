// PATCH  /api/misc-income/:id   → update label, amount, or notes
// DELETE /api/misc-income/:id   → delete bucket. Detaches any attached transactions
//                                  (sets their misc_income_id to NULL).

import { json, badRequest, notFound, serverError, toInt, dollarsToCents } from "../../lib/db";

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

  if (typeof body.label === "string") {
    const trimmed = body.label.trim();
    if (!trimmed) return badRequest("label cannot be empty");
    updates.push("label = ?");
    bindings.push(trimmed);
  }
  if (body.amount !== undefined) {
    const cents = dollarsToCents(body.amount);
    if (cents === null || cents <= 0) return badRequest("amount must be > 0");
    updates.push("amount_cents = ?");
    bindings.push(cents);
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

  if (updates.length === 0) return badRequest("no fields to update");

  try {
    bindings.push(id);
    const sql = `UPDATE misc_income SET ${updates.join(", ")} WHERE id = ?`;
    const r = await ctx.env.DB.prepare(sql).bind(...bindings).run();
    if (r.meta.changes === 0) return notFound();
    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");
  try {
    // Detach any attached transactions first (set misc_income_id back to NULL).
    // The bucket's source transaction is also detached, returning it to whatever
    // it was (typically uncategorized, since creating the bucket cleared category).
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `UPDATE transactions SET misc_income_id = NULL WHERE misc_income_id = ?`,
      ).bind(id),
      ctx.env.DB.prepare(`DELETE FROM misc_income WHERE id = ?`).bind(id),
    ]);
    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
