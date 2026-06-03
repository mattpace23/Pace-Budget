// Parser for Chase credit card CSV exports (Sapphire Reserve + Amazon Visa
// both use this layout). Header:
//   Transaction Date,Post Date,Description,Category,Type,Amount,Memo
//
// Sign convention in source: negative = purchase, positive = payment/credit.
// Our schema: positive = money out, negative = money in. So we flip the sign.

import Papa from "papaparse";
import type { ParsedRow, ParseResult } from "./types";
import { decodeHtmlEntities, mdYyyyToIso, moneyToCents, stripBom } from "./utils";

const EXPECTED_HEADERS = [
  "Transaction Date",
  "Post Date",
  "Description",
  "Category",
  "Type",
  "Amount",
  "Memo",
];

export function parseChase(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(stripBom(csv), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: "CSV parse error",
      details: parsed.errors.map((e) => `row ${e.row}: ${e.message}`),
    };
  }

  const headers = parsed.meta.fields ?? [];
  const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "CSV header doesn't match the Chase format",
      details: [`Missing columns: ${missing.join(", ")}`, `Got: ${headers.join(", ")}`],
    };
  }

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const lineNo = i + 2;

    // Use Post Date as canonical — that's the date the transaction settled, which
    // aligns with how the bank views it for monthly statements.
    const dateRaw = (r["Post Date"] || "").trim();
    const description = decodeHtmlEntities((r["Description"] || "").trim());
    const amountRaw = (r["Amount"] || "").trim();
    const category = (r["Category"] || "").trim();
    const type = (r["Type"] || "").trim();

    if (!dateRaw && !description && !amountRaw) continue;

    const isoDate = mdYyyyToIso(dateRaw);
    if (!isoDate) {
      warnings.push(`Line ${lineNo}: invalid date "${dateRaw}", skipping`);
      continue;
    }

    if (!description) {
      warnings.push(`Line ${lineNo}: missing description, skipping`);
      continue;
    }

    const chaseCents = moneyToCents(amountRaw);
    if (chaseCents === null || chaseCents === 0) {
      warnings.push(`Line ${lineNo}: no amount, skipping`);
      continue;
    }

    // Flip sign: Chase −$X (purchase) → our +X cents (money out);
    //            Chase +$X (payment/refund) → our −X cents (money in).
    const amount_cents = -chaseCents;

    // Preserve both Category and Type in raw_classification for reference.
    const raw_classification =
      [category, type].filter(Boolean).join(" / ") || undefined;

    rows.push({
      posted_at_iso: isoDate,
      description,
      amount_cents,
      raw_classification,
    });
  }

  return { ok: true, rows, warnings };
}
