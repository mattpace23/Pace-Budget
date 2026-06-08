// GET /api/simplefin/status
// Returns whether SimpleFin is configured, when each account last synced,
// and a list of SimpleFin accounts (fetched live, balances-only) so the user
// can map them. Returns empty list of remote accounts if not configured.

import { json, serverError } from "../../lib/db";
import { fetchAccounts, type SimpleFinAccount } from "../../lib/simplefin";

interface Env {
  DB: D1Database;
}

interface AccountRow {
  id: number;
  name: string;
  simplefin_account_id: string | null;
  simplefin_last_sync_at: number | null;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const setting = await ctx.env.DB.prepare(
      `SELECT value FROM settings WHERE key = ?`,
    )
      .bind("simplefin_access_url")
      .first<{ value: string }>();
    const accessUrl = setting?.value ?? null;

    const { results: accounts } = await ctx.env.DB.prepare(
      `SELECT id, name, simplefin_account_id, simplefin_last_sync_at FROM accounts ORDER BY id`,
    ).all<AccountRow>();

    let remoteAccounts: { id: string; name: string; org: string; balance: string }[] = [];
    let configured = !!accessUrl;
    let fetchError: string | null = null;

    if (accessUrl) {
      try {
        const res = await fetchAccounts(accessUrl, { balancesOnly: true });
        remoteAccounts = res.accounts.map((a: SimpleFinAccount) => ({
          id: a.id,
          name: a.name,
          org: a.org?.name ?? "",
          balance: a.balance,
        }));
      } catch (e) {
        fetchError = (e as Error).message;
      }
    }

    return json({
      configured,
      fetch_error: fetchError,
      remote_accounts: remoteAccounts,
      local_accounts: accounts,
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
