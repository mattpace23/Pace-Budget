-- Buckets can now be closed manually. When closed, the user picks what to do
-- with any remaining positive balance: transfer to savings (counts as a savings
-- contribution in the close month) or discard (no impact). Overdrawn buckets
-- can't be closed — the user must split the offending transaction first so the
-- overage goes to a real category.

ALTER TABLE misc_income ADD COLUMN closed_at INTEGER;
ALTER TABLE misc_income ADD COLUMN closed_disposition TEXT;
ALTER TABLE misc_income ADD COLUMN savings_transfer_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_misc_closed ON misc_income(closed_at);
