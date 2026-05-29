// Shared shape every parser returns. A parser knows how to turn one bank's
// CSV into rows the upload API can ingest.

export type ParsedRow = {
  posted_at_iso: string; // YYYY-MM-DD
  description: string;
  amount_cents: number; // + = money out (debit), - = money in (credit)
  raw_classification?: string;
};

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; warnings: string[] }
  | { ok: false; error: string; details?: string[] };

export type ParserId = "main_checking" | "chase_reserve" | "chase_amazon";
