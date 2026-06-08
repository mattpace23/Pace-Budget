// POST /api/simplefin/configure
// Body: { setup_token } OR { access_url }
// Stores the access URL in settings. If a setup_token is provided, exchanges
// it for the access URL first.

import { json, badRequest, serverError } from "../../lib/db";
import { exchangeSetupToken, fetchAccounts } from "../../lib/simplefin";

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

  let accessUrl: string;
  if (typeof body.access_url === "string" && body.access_url.trim()) {
    accessUrl = body.access_url.trim();
  } else if (typeof body.setup_token === "string" && body.setup_token.trim()) {
    try {
      accessUrl = await exchangeSetupToken(body.setup_token);
    } catch (e) {
      return badRequest((e as Error).message);
    }
  } else {
    return badRequest("provide setup_token or access_url");
  }

  // Validate by fetching balances only.
  try {
    await fetchAccounts(accessUrl, { balancesOnly: true });
  } catch (e) {
    return badRequest(`access URL didn't work: ${(e as Error).message}`);
  }

  try {
    await ctx.env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    )
      .bind("simplefin_access_url", accessUrl)
      .run();

    return json({ ok: true, access_url_saved: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
