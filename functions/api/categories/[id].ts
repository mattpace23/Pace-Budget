// PATCH  /api/categories/:id   → partial update (name, amount, kind, sort_order, archived)
// DELETE /api/categories/:id   → archive (soft delete). Hard delete only if no transactions reference it.

import {
  json,
  badRequest,
  notFound,
  serverError,
  toInt,
  dollarsToCents,
} from "../../lib/db";

interface Env {
  DB: D1Database;
}

interface CategoryRow {
  id: number;
  name: string;
  amount: number;
  kind: "expense" | "savings" | "income";
  sort_order: number;
  archived: number;
  created_at: number;
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
  const bindings: (string | number)[] = [];

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return badRequest("name cannot be empty");
    updates.push("name = ?");
    bindings.push(trimmed);
  }
  if (body.amount !== undefined) {
    const cents = dollarsToCents(body.amount);
    if (cents === null || cents < 0) return badRequest("amount must be a non-negative number");
    updates.push("amount = ?");
    bindings.push(cents);
  }
  if (body.kind !== undefined) {
    if (body.kind !== "expense" && body.kind !== "savings" && body.kind !== "income") {
      return badRequest("kind must be expense, savings, or income");
    }
    updates.push("kind = ?");
    bindings.push(body.kind);
  }
  if (body.sort_order !== undefined) {
    const so = toInt(body.sort_order);
    if (so === null) return badRequest("sort_order must be an integer");
    updates.push("sort_order = ?");
    bindings.push(so);
  }
  if (body.archived !== undefined) {
    updates.push("archived = ?");
    bindings.push(body.archived ? 1 : 0);
  }

  if (updates.length === 0) return badRequest("no fields to update");

  try {
    bindings.push(id);
    const sql = `UPDATE categories SET ${updates.join(", ")} WHERE id = ?`;
    const r = await ctx.env.DB.prepare(sql).bind(...bindings).run();
    if (r.meta.changes === 0) return notFound();

    const updated = await ctx.env.DB.prepare(
      `SELECT * FROM categories WHERE id = ?`,
    )
      .bind(id)
      .first<CategoryRow>();

    if (!updated) return notFound();
    return json({ category: serialize(updated) });
  } catch (e) {
    const msg = (e as Error).message;
    if (/UNIQUE/.test(msg)) return badRequest("a category with that name already exists");
    return serverError(msg);
  }
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const id = toInt(ctx.params.id);
  if (id === null) return badRequest("invalid id");

  try {
    // Check if any transactions or splits reference this category.
    const refs = await ctx.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE category_id = ?) +
         (SELECT COUNT(*) FROM transaction_splits WHERE category_id = ?) AS n`,
    )
      .bind(id, id)
      .first<{ n: number }>();

    const hasRefs = (refs?.n ?? 0) > 0;

    if (hasRefs) {
      // Soft-delete: archive instead of hard delete to preserve historical data.
      const r = await ctx.env.DB.prepare(
        `UPDATE categories SET archived = 1 WHERE id = ?`,
      )
        .bind(id)
        .run();
      if (r.meta.changes === 0) return notFound();
      return json({ archived: true, reason: "has_transactions" });
    } else {
      const r = await ctx.env.DB.prepare(`DELETE FROM categories WHERE id = ?`)
        .bind(id)
        .run();
      if (r.meta.changes === 0) return notFound();
      return json({ deleted: true });
    }
  } catch (e) {
    return serverError((e as Error).message);
  }
};

function serialize(c: CategoryRow) {
  return {
    id: c.id,
    name: c.name,
    amount_cents: c.amount,
    kind: c.kind,
    sort_order: c.sort_order,
    archived: c.archived === 1,
    created_at: c.created_at,
  };
}
