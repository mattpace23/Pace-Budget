// POST /api/simplefin/map
// Body: { account_id, simplefin_account_id }
// Maps a Pace Budget account to a SimpleFin account ID (or clears it if null).

import { json, badRequest, notFound, serverError, toInt } from "../../lib/db";

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const accountId = toInt(body.account_id);
  if (accountId === null) return badRequest("account_id required");

  const sfId =
    body.simplefin_account_id === null || body.simplefin_account_id === ""
      ? null
      : typeof body.simplefin_account_id === "string"
      ? body.simplefin_account_id
      : null;
  if (sfId === null && body.simplefin_account_id !== null && body.simplefin_account_id !== "") {
    return badRequest("simplefin_account_id must be a string or null");
  }

  try {
    const r = await ctx.env.DB.prepare(
      `UPDATE accounts SET simplefin_account_id = ? WHERE id = ?`,
    )
      .bind(sfId, accountId)
      .run();
    if (r.meta.changes === 0) return notFound();
    return json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
