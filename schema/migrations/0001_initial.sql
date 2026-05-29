-- Pace Budget initial schema.
-- Run with: wrangler d1 migrations apply pace-budget --local   (for local dev)
--      or:  wrangler d1 migrations apply pace-budget --remote  (for production)

-- =============================================================================
-- categories: your budget categories. Editable in the app.
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  amount      INTEGER NOT NULL,                  -- monthly budget in cents
  kind        TEXT NOT NULL DEFAULT 'expense',   -- 'expense' | 'savings' | 'income'
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,        -- soft delete
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- =============================================================================
-- accounts: the three source accounts (and any future ones).
-- =============================================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,              -- 'Main Checking', 'Chase Reserve', 'Chase Amazon'
  kind        TEXT NOT NULL,                     -- 'checking' | 'credit_card'
  parser      TEXT NOT NULL,                     -- 'main_checking' | 'chase_reserve' | 'chase_amazon'
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- =============================================================================
-- transactions: every row from every uploaded CSV.
-- Dedup key = (account_id, posted_at_iso, amount_cents, description).
-- =============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id),
  posted_at_iso     TEXT NOT NULL,               -- 'YYYY-MM-DD'
  description       TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,            -- positive = money out (debit), negative = money in (credit)
  raw_classification TEXT,                       -- bank's own tag (we ignore for assignment, keep for reference)
  is_transfer       INTEGER NOT NULL DEFAULT 0,  -- auto-flagged transfers (CC payments, sub-account moves) excluded from spending
  category_id       INTEGER REFERENCES categories(id),  -- null when uncategorized; ignored if split
  misc_income_id    INTEGER REFERENCES misc_income(id), -- attaches an expense to a misc-income bucket
  notes             TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(account_id, posted_at_iso, amount_cents, description)
);

CREATE INDEX IF NOT EXISTS idx_tx_month ON transactions(posted_at_iso);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, posted_at_iso);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

-- =============================================================================
-- transaction_splits: when one transaction is split across 2-3 categories.
-- When a row exists in splits for a transaction, the transactions.category_id
-- is ignored and amounts come from here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS transaction_splits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  amount_cents    INTEGER NOT NULL,              -- must sum to transaction.amount_cents
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_split_tx ON transaction_splits(transaction_id);

-- =============================================================================
-- merchant_memory: learned categorizations. After you tag 'Starbucks' once,
-- future Starbucks transactions auto-apply this category.
-- =============================================================================
CREATE TABLE IF NOT EXISTS merchant_memory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_key    TEXT NOT NULL UNIQUE,          -- normalized description (lowercase, trimmed, location stripped)
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  is_transfer     INTEGER NOT NULL DEFAULT 0,    -- if 1, future matches are auto-flagged as transfers
  hit_count       INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- =============================================================================
-- misc_income: one bucket per occurrence (e.g., 'Mom — iPads $1500').
-- Expenses can be attached via transactions.misc_income_id.
-- =============================================================================
CREATE TABLE IF NOT EXISTS misc_income (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,                 -- 'Mom — iPads', 'Robinhood proceeds', etc.
  amount_cents    INTEGER NOT NULL,              -- how much extra income this bucket received
  occurred_at_iso TEXT NOT NULL,                 -- 'YYYY-MM-DD' (for monthly filtering)
  source_tx_id    INTEGER REFERENCES transactions(id), -- the deposit transaction that created the bucket
  notes           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_misc_month ON misc_income(occurred_at_iso);

-- =============================================================================
-- uploads: tracks which CSV files have been ingested (which month, which account).
-- Shown in the UI so you know what you've already uploaded.
-- =============================================================================
CREATE TABLE IF NOT EXISTS uploads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          INTEGER NOT NULL REFERENCES accounts(id),
  filename            TEXT NOT NULL,
  earliest_date_iso   TEXT NOT NULL,
  latest_date_iso     TEXT NOT NULL,
  row_count           INTEGER NOT NULL,
  rows_inserted       INTEGER NOT NULL,           -- excludes duplicates
  rows_duplicated     INTEGER NOT NULL,
  uploaded_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- =============================================================================
-- settings: misc key-value config (cumulative savings starting balance, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- =============================================================================
-- Seed: the three accounts and the current Pace budget categories.
-- =============================================================================
INSERT OR IGNORE INTO accounts (name, kind, parser) VALUES
  ('Main Checking',  'checking',    'main_checking'),
  ('Chase Reserve',  'credit_card', 'chase_reserve'),
  ('Chase Amazon',   'credit_card', 'chase_amazon');

INSERT OR IGNORE INTO categories (name, amount, kind, sort_order) VALUES
  ('Giving',            40000,  'expense',  10),
  ('Mortgage',         205000,  'expense',  20),
  ('Utilities',         35000,  'expense',  30),
  ('Food & Home',      125000,  'expense',  40),
  ('Car Insurance',     18000,  'expense',  50),
  ('Car Maintenance',    7500,  'expense',  60),
  ('Gas & Cell',        38500,  'expense',  70),
  ('Life Insurance',     4000,  'expense',  80),
  ('Amazon',             7500,  'expense',  90),
  ('Gift',               7500,  'expense', 100),
  ('Home Improvement',  14000,  'expense', 110),
  ('Entertainment',      3500,  'expense', 120),
  ('Allie',             25000,  'expense', 130),
  ('Matt',               7500,  'expense', 140),
  ('Pen & Walker',      30000,  'expense', 150),
  ('Babysitting',           0,  'expense', 160),
  ('Small Group',       16000,  'expense', 170),
  ('HSA',               25000,  'expense', 180),
  ('Investing',         66000,  'savings', 190);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('savings_starting_balance_cents', '0'),
  ('savings_starting_as_of_iso',     '2026-05-01');
