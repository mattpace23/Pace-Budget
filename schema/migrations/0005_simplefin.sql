-- SimpleFin Bridge integration: automated daily transaction sync.
--
-- Columns added:
--  - transactions.simplefin_id    — SimpleFin's stable per-transaction ID.
--                                    Used as the primary dedup key for synced
--                                    transactions. UNIQUE so re-running sync
--                                    doesn't create dupes.
--  - accounts.simplefin_account_id — the SimpleFin account ID this Pace Budget
--                                    account is mapped to (NULL = not synced).
--  - accounts.simplefin_last_sync_at — unix ts of last successful sync, for
--                                      incremental syncs.

ALTER TABLE transactions ADD COLUMN simplefin_id TEXT;

-- Partial unique index: only enforce uniqueness when simplefin_id is set, so
-- CSV-uploaded rows (with NULL) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_simplefin
  ON transactions(simplefin_id)
  WHERE simplefin_id IS NOT NULL;

ALTER TABLE accounts ADD COLUMN simplefin_account_id TEXT;
ALTER TABLE accounts ADD COLUMN simplefin_last_sync_at INTEGER;

-- Settings keys (managed via the existing settings table — no schema change):
--   simplefin_access_url   — base URL with embedded HTTP Basic Auth
--   simplefin_cron_secret  — shared token for external cron callers
