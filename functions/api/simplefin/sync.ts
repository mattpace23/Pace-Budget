// POST /api/simplefin/sync
// Fetches new transactions from SimpleFin for every mapped account and inserts
// them into D1. Idempotent: re-running this won't create duplicates because
// each SimpleFin transaction has a unique ID enforced by a partial unique index.
//
// Authentication: this endpoint is normally behind the password gate (like every
// other /api/* route). External cron callers can bypass that gate by sending the
// shared secret stored in the `simplefin_cron_secret` setting as either a query
// parameter (?secret=...) or the X-Cron-Secret header.

import { json, badRequest, serverError } from "../../lib/db";
import { autoApply } from "../../lib/merchant";
import {
  fetchAccounts,
  simplefinAmountToCents,
  simplefinDateToIso,
  type SimpleFinTransaction,
} from "../../lib/simplefin";

interface Env {
  DB: D1Database;
}

interface AccountRow {
  id: number;
  name: string;
  simplefin_account_id: string | null;
  simplefin_last_sync_at: number | null;
}

const DEFAULT_LOOKBACK_DAYS = 60;

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const result = await runSync(ctx.env.DB);
    return json(result);
  } catch (e) {
    return serverError((e as Error).message);
  }
};

// Exported so the scheduled Worker (cron) and the manual endpoint share one
// implementation.
export async function runSync(db: D1Database): Promise<{
  ok: true;
  synced_accounts: number;
  new_transactions: number;
  per_account: { account_id: number; name: string; new: number }[];
  errors: string[];
  warning?: string;
}> {
  const accessSetting = await db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("simplefin_access_url")
    .first<{ value: string }>();
  if (!accessSetting?.value) {
    return {
      ok: true,
      synced_accounts: 0,
      new_transactions: 0,
      per_account: [],
      errors: [],
      warning: "SimpleFin not configured — set an access URL in Settings.",
    };
  }
  const accessUrl = accessSetting.value;

  const { results: mappedAccounts } = await db
    .prepare(
      `SELECT id, name, simplefin_account_id, simplefin_last_sync_at
         FROM accounts WHERE simplefin_account_id IS NOT NULL`,
    )
    .all<AccountRow>();

  if (mappedAccounts.length === 0) {
    return {
      ok: true,
      synced_accounts: 0,
      new_transactions: 0,
      per_account: [],
      errors: [],
      warning:
        "No SimpleFin account is mapped to a Pace Budget account. Set the mapping in Settings.",
    };
  }

  // Determine earliest start-date across all mapped accounts so one SimpleFin
  // request covers everything.
  const now = Math.floor(Date.now() / 1000);
  const fallbackStart = now - DEFAULT_LOOKBACK_DAYS * 24 * 3600;
  let minLastSync = Infinity;
  for (const a of mappedAccounts) {
    const last = a.simplefin_last_sync_at ?? fallbackStart;
    if (last < minLastSync) minLastSync = last;
  }
  // Re-fetch a bit before last sync to capture late-posting items.
  const startDate = Math.max(0, minLastSync - 24 * 3600);

  const res = await fetchAccounts(accessUrl, { startDate, pending: false });
  const errors: string[] = [...(res.errors ?? [])];

  // Map SimpleFin account ID → local account row, for fast lookup.
  const byRemoteId = new Map<string, AccountRow>();
  for (const a of mappedAccounts) {
    if (a.simplefin_account_id) byRemoteId.set(a.simplefin_account_id, a);
  }

  const perAccount: { account_id: number; name: string; new: number }[] = [];
  let totalInserted = 0;
  const syncedLocalIds: number[] = [];

  for (const sfAccount of res.accounts) {
    const local = byRemoteId.get(sfAccount.id);
    if (!local) continue; // unmapped SimpleFin account — skip silently
    syncedLocalIds.push(local.id);

    let inserted = 0;
    const categoryCache = new Map<string, number | null>();
    for (const tx of sfAccount.transactions) {
      try {
        const created = await insertTransaction(db, local.id, tx, categoryCache);
        if (created) inserted++;
      } catch (e) {
        errors.push(
          `account ${local.name} tx ${tx.id}: ${(e as Error).message}`,
        );
      }
    }
    perAccount.push({ account_id: local.id, name: local.name, new: inserted });
    totalInserted += inserted;
  }

  // Update last-sync time for every account we attempted to sync.
  if (syncedLocalIds.length > 0) {
    const placeholders = syncedLocalIds.map(() => "?").join(",");
    await db
      .prepare(
        `UPDATE accounts SET simplefin_last_sync_at = unixepoch() WHERE id IN (${placeholders})`,
      )
      .bind(...syncedLocalIds)
      .run();
  }

  return {
    ok: true,
    synced_accounts: syncedLocalIds.length,
    new_transactions: totalInserted,
    per_account: perAccount,
    errors,
  };
}

async function insertTransaction(
  db: D1Database,
  accountId: number,
  tx: SimpleFinTransaction,
  categoryCache: Map<string, number | null>,
): Promise<boolean> {
  const date = simplefinDateToIso(tx.posted);
  const amount = simplefinAmountToCents(tx.amount);
  if (amount === 0) return false;
  // Compose description: prefer `payee` if present, fall back to `description`.
  // Append memo in parens if it adds info.
  const baseDesc = (tx.payee || tx.description || "").trim();
  if (!baseDesc) return false;
  const memo = tx.memo?.trim();
  const description =
    memo && memo.toLowerCase() !== baseDesc.toLowerCase()
      ? `${baseDesc} (${memo})`
      : baseDesc;

  // Check if this SimpleFin transaction is already in the DB.
  const existing = await db
    .prepare(`SELECT id FROM transactions WHERE simplefin_id = ?`)
    .bind(tx.id)
    .first<{ id: number }>();
  if (existing) return false;

  // Compute next available dedup_ordinal for the (account, date, amount, desc)
  // key so we don't conflict with prior CSV-uploaded rows or other SimpleFin
  // transactions sharing the same signature.
  const maxOrd = await db
    .prepare(
      `SELECT COALESCE(MAX(dedup_ordinal), 0) AS m FROM transactions
        WHERE account_id = ? AND posted_at_iso = ? AND amount_cents = ? AND description = ?`,
    )
    .bind(accountId, date, amount, description)
    .first<{ m: number }>();
  const ordinal = (maxOrd?.m ?? 0) + 1;

  // Apply hardcoded auto-rules (envelope transfers, Chase CC payment, etc.).
  const auto = await autoApply(db, description, categoryCache);

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO transactions
         (account_id, posted_at_iso, description, amount_cents, raw_classification,
          simplefin_id, dedup_ordinal, is_transfer, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      accountId,
      date,
      description,
      amount,
      "simplefin",
      tx.id,
      ordinal,
      auto.is_transfer,
      auto.category_id,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}
