// GET  /api/uploads  → list uploads (most recent first)
// POST /api/uploads  → ingest a parsed CSV's rows

import { json, badRequest, serverError, toInt } from "../../lib/db";

interface Env {
  DB: D1Database;
}

interface UploadRow {
  id: number;
  account_id: number;
  filename: string;
  earliest_date_iso: string;
  latest_date_iso: string;
  row_count: number;
  rows_inserted: number;
  rows_duplicated: number;
  uploaded_at: number;
}

interface IncomingRow {
  posted_at_iso: string;
  description: string;
  amount_cents: number;
  raw_classification?: string;
}

interface PostBody {
  account_id?: unknown;
  filename?: unknown;
  rows?: unknown;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { results } = await ctx.env.DB.prepare(
      `SELECT u.id, u.account_id, u.filename, u.earliest_date_iso, u.latest_date_iso,
              u.row_count, u.rows_inserted, u.rows_duplicated, u.uploaded_at,
              a.name AS account_name
         FROM uploads u
         JOIN accounts a ON a.id = u.account_id
         ORDER BY u.uploaded_at DESC, u.id DESC`,
    ).all<UploadRow & { account_name: string }>();
    return json({ uploads: results });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: PostBody;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const accountId = toInt(body.account_id);
  if (accountId === null) return badRequest("account_id is required");

  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!filename) return badRequest("filename is required");

  if (!Array.isArray(body.rows)) return badRequest("rows must be an array");
  if (body.rows.length === 0) return badRequest("no rows to ingest");
  if (body.rows.length > 10000) return badRequest("too many rows in one upload (max 10000)");

  // Validate the account exists.
  const account = await ctx.env.DB.prepare(
    `SELECT id FROM accounts WHERE id = ?`,
  )
    .bind(accountId)
    .first<{ id: number }>();
  if (!account) return badRequest("unknown account_id");

  // Validate rows.
  const rows: IncomingRow[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] as Partial<IncomingRow>;
    if (typeof r?.posted_at_iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.posted_at_iso)) {
      return badRequest(`row ${i}: invalid posted_at_iso`);
    }
    if (typeof r?.description !== "string" || r.description.trim() === "") {
      return badRequest(`row ${i}: invalid description`);
    }
    if (typeof r?.amount_cents !== "number" || !Number.isFinite(r.amount_cents)) {
      return badRequest(`row ${i}: invalid amount_cents`);
    }
    rows.push({
      posted_at_iso: r.posted_at_iso,
      description: r.description.trim(),
      amount_cents: Math.trunc(r.amount_cents),
      raw_classification:
        typeof r.raw_classification === "string" ? r.raw_classification : undefined,
    });
  }

  // Determine min/max date for the uploads record.
  let earliest = rows[0].posted_at_iso;
  let latest = rows[0].posted_at_iso;
  for (const r of rows) {
    if (r.posted_at_iso < earliest) earliest = r.posted_at_iso;
    if (r.posted_at_iso > latest) latest = r.posted_at_iso;
  }

  // Insert with dedup via the UNIQUE constraint on
  // (account_id, posted_at_iso, amount_cents, description).
  try {
    let inserted = 0;
    let duplicated = 0;

    // D1 supports batches; chunk into groups to stay within statement limits.
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const statements = chunk.map((r) =>
        ctx.env.DB.prepare(
          `INSERT OR IGNORE INTO transactions
             (account_id, posted_at_iso, description, amount_cents, raw_classification)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          accountId,
          r.posted_at_iso,
          r.description,
          r.amount_cents,
          r.raw_classification ?? null,
        ),
      );
      const batchResults = await ctx.env.DB.batch(statements);
      for (const br of batchResults) {
        if (br.meta.changes && br.meta.changes > 0) inserted++;
        else duplicated++;
      }
    }

    const uploadResult = await ctx.env.DB.prepare(
      `INSERT INTO uploads
         (account_id, filename, earliest_date_iso, latest_date_iso,
          row_count, rows_inserted, rows_duplicated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(accountId, filename, earliest, latest, rows.length, inserted, duplicated)
      .run();

    const upload = await ctx.env.DB.prepare(
      `SELECT u.id, u.account_id, u.filename, u.earliest_date_iso, u.latest_date_iso,
              u.row_count, u.rows_inserted, u.rows_duplicated, u.uploaded_at,
              a.name AS account_name
         FROM uploads u
         JOIN accounts a ON a.id = u.account_id
         WHERE u.id = ?`,
    )
      .bind(uploadResult.meta.last_row_id)
      .first<UploadRow & { account_name: string }>();

    return json({ upload }, 201);
  } catch (e) {
    return serverError((e as Error).message);
  }
};
