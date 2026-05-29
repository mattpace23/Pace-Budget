-- Replace the UNIQUE constraint on transactions to include a per-upload ordinal.
-- The old constraint silently collapsed legitimate same-day identical transactions
-- (e.g., three kids' admissions at Urban Air for $54.40 each on the same day).
-- With dedup_ordinal, those become rows 1, 2, 3 in the same group, all preserved.
-- Re-uploading the same CSV still dedupes cleanly: ordinals match and INSERT OR IGNORE
-- skips them.

CREATE TABLE transactions_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         INTEGER NOT NULL REFERENCES accounts(id),
  posted_at_iso      TEXT NOT NULL,
  description        TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  raw_classification TEXT,
  is_transfer        INTEGER NOT NULL DEFAULT 0,
  category_id        INTEGER REFERENCES categories(id),
  misc_income_id     INTEGER REFERENCES misc_income(id),
  notes              TEXT,
  dedup_ordinal      INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(account_id, posted_at_iso, amount_cents, description, dedup_ordinal)
);

-- Existing rows all become ordinal=1. After the user re-uploads the May CSV,
-- the previously-collapsed duplicates will come in as ordinals 2, 3 etc.
INSERT INTO transactions_new
  (id, account_id, posted_at_iso, description, amount_cents, raw_classification,
   is_transfer, category_id, misc_income_id, notes, dedup_ordinal, created_at)
SELECT
   id, account_id, posted_at_iso, description, amount_cents, raw_classification,
   is_transfer, category_id, misc_income_id, notes, 1 AS dedup_ordinal, created_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- Recreate the indexes that were on the original table.
CREATE INDEX idx_tx_month ON transactions(posted_at_iso);
CREATE INDEX idx_tx_account ON transactions(account_id, posted_at_iso);
CREATE INDEX idx_tx_category ON transactions(category_id);
