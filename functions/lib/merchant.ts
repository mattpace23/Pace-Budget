// Merchant key normalization + auto-categorization rules.
//
// normalizeMerchantKey: strip date suffixes, apostrophes, lowercase, etc. so
// "Hurts Donut Company Springfield Mo 05-26-" and "...05-22-" map to the same
// key. The key is what we store in `merchant_memory` for learned mappings.
//
// AUTO_RULES: hardcoded patterns for things we can reliably detect without
// learning — Pace family's envelope transfers, the Chase CC payment, and
// the Fidelity investment contribution. Patterns are substring matches
// (case-insensitive) unless tagged as a regex.

export function normalizeMerchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/'/g, "") // sam's → sams, domino's → dominos
    .replace(/\s+\d{2}-\d{2}-?$/g, "") // strip trailing " 05-26-" date suffix
    .replace(/\s+\d{2}\/\d{2}\/\d{4}$/g, "") // strip trailing " 05/26/2026"
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

export type AutoAction =
  | { kind: "transfer" }
  | { kind: "category"; category_name: string };

interface Rule {
  match: RegExp;
  action: AutoAction;
  label: string; // human-readable for debugging
}

// Order matters — first match wins. Be specific before general.
const AUTO_RULES: Rule[] = [
  // Envelope transfers — auto-categorize as the matching budget category. These
  // ARE the planned spending for that category (see the design doc in README).
  { match: /S Groceries/i, action: { kind: "category", category_name: "Food & Home" }, label: "envelope → Food & Home" },
  { match: /S Car Savings/i, action: { kind: "category", category_name: "Car Maintenance" }, label: "envelope → Car Maintenance" },
  { match: /S Allie Personal/i, action: { kind: "category", category_name: "Allie" }, label: "envelope → Allie" },
  { match: /S Matt Personal/i, action: { kind: "category", category_name: "Matt" }, label: "envelope → Matt" },
  { match: /S Home Improvement/i, action: { kind: "category", category_name: "Home Improvement" }, label: "envelope → Home Improvement" },
  { match: /L House Payment/i, action: { kind: "category", category_name: "Mortgage" }, label: "envelope → Mortgage" },

  // Savings contribution
  { match: /Fidelity Brokerage/i, action: { kind: "category", category_name: "Investing" }, label: "Fidelity → Investing" },

  // Credit-card payment from checking — pure transfer (the underlying purchases
  // come in via the credit-card CSV separately).
  { match: /^Chase Credit Card$/, action: { kind: "transfer" }, label: "Chase CC payment" },
];

export function findAutoRule(description: string): AutoAction | null {
  for (const rule of AUTO_RULES) {
    if (rule.match.test(description)) return rule.action;
  }
  return null;
}

// Resolve a category name to an id from the DB. Returns null if not found or
// archived. Caches per-request via a Map the caller provides.
export async function categoryIdByName(
  db: D1Database,
  name: string,
  cache?: Map<string, number | null>,
): Promise<number | null> {
  if (cache?.has(name)) return cache.get(name)!;
  const row = await db
    .prepare(`SELECT id FROM categories WHERE name = ? AND archived = 0`)
    .bind(name)
    .first<{ id: number }>();
  const id = row?.id ?? null;
  cache?.set(name, id);
  return id;
}

export interface AutoApplyResult {
  is_transfer: 0 | 1;
  category_id: number | null;
  source: "rule" | "memory" | null;
}

// Determine what to auto-apply for a row at upload time.
// Tries hardcoded rules first, then merchant_memory.
export async function autoApply(
  db: D1Database,
  description: string,
  categoryCache?: Map<string, number | null>,
): Promise<AutoApplyResult> {
  const rule = findAutoRule(description);
  if (rule) {
    if (rule.kind === "transfer") {
      return { is_transfer: 1, category_id: null, source: "rule" };
    } else {
      const id = await categoryIdByName(db, rule.category_name, categoryCache);
      if (id) return { is_transfer: 0, category_id: id, source: "rule" };
    }
  }

  // Fall through to merchant_memory.
  const key = normalizeMerchantKey(description);
  const mem = await db
    .prepare(
      `SELECT category_id, is_transfer FROM merchant_memory WHERE merchant_key = ?`,
    )
    .bind(key)
    .first<{ category_id: number; is_transfer: number }>();
  if (mem) {
    return {
      is_transfer: mem.is_transfer === 1 ? 1 : 0,
      category_id: mem.is_transfer === 1 ? null : mem.category_id,
      source: "memory",
    };
  }

  return { is_transfer: 0, category_id: null, source: null };
}
