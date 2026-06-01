-- Budget refresh (June 2026). Reflects updated Pace Budget.csv.
-- Net change is +$250 in paycheck distributed across mortgage, utilities,
-- and investing, with car insurance reduced and small group zeroed out.

UPDATE categories SET amount = 235000 WHERE name = 'Mortgage';
UPDATE categories SET amount = 45000  WHERE name = 'Utilities';
UPDATE categories SET amount = 13000  WHERE name = 'Car Insurance';
UPDATE categories SET amount = 0      WHERE name = 'Small Group';
UPDATE categories SET amount = 72000  WHERE name = 'Investing';
