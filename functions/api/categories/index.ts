// GET  /api/categories         → list all (active + archived)
// POST /api/categories         → create

import { json, badRequest, dollarsToCents, serverError } from "../../lib/db";

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

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  const sql = includeArchived
    ? `SELECT * FROM categories ORDER BY archived ASC, sort_order ASC, id ASC`
    : `SELECT * FROM categories WHERE archived = 0 ORDER BY sort_order ASC, id ASC`;

  try {
    const { results } = await ctx.env.DB.prepare(sql).all<CategoryRow>();
    return json({ categories: results.map(serialize) });
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");

  const amountCents = dollarsToCents(body.amount ?? 0) ?? 0;
  if (amountCents < 0) return badRequest("amount must be >= 0");

  const kind: "expense" | "savings" | "income" =
    body.kind === "savings" || body.kind === "income" ? body.kind : "expense";

  try {
    // New categories go to the end of the sort order by default.
    const maxOrder = await ctx.env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) as m FROM categories`,
    ).first<{ m: number }>();
    const nextOrder = (maxOrder?.m ?? 0) + 10;

    const result = await ctx.env.DB.prepare(
      `INSERT INTO categories (name, amount, kind, sort_order) VALUES (?, ?, ?, ?)`,
    )
      .bind(name, amountCents, kind, nextOrder)
      .run();

    const created = await ctx.env.DB.prepare(
      `SELECT * FROM categories WHERE id = ?`,
    )
      .bind(result.meta.last_row_id)
      .first<CategoryRow>();

    if (!created) return serverError("created but not found");
    return json({ category: serialize(created) }, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (/UNIQUE/.test(msg)) return badRequest("a category with that name already exists");
    return serverError(msg);
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
