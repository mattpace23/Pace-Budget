// Parser for the main checking CSV format. Header looks like:
//   Account Number,Post Date,Check,Description,Debit,Credit,Status,Classification

import Papa from "papaparse";
import type { ParsedRow, ParseResult } from "./types";

const EXPECTED_HEADERS = [
  "Account Number",
  "Post Date",
  "Check",
  "Description",
  "Debit",
  "Credit",
  "Status",
  "Classification",
];

export function parseMainChecking(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
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
      error: "CSV header doesn't match the main checking format",
      details: [`Missing columns: ${missing.join(", ")}`, `Got: ${headers.join(", ")}`],
    };
  }

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const lineNo = i + 2; // +1 for header, +1 for 1-indexed

    const dateRaw = (r["Post Date"] || "").trim();
    const description = decodeHtmlEntities((r["Description"] || "").trim());
    const debitRaw = (r["Debit"] || "").trim();
    const creditRaw = (r["Credit"] || "").trim();
    const classification = (r["Classification"] || "").trim();

    if (!dateRaw && !description && !debitRaw && !creditRaw) continue; // empty row

    const isoDate = mdYyyyToIso(dateRaw);
    if (!isoDate) {
      warnings.push(`Line ${lineNo}: invalid date "${dateRaw}", skipping`);
      continue;
    }

    if (!description) {
      warnings.push(`Line ${lineNo}: missing description, skipping`);
      continue;
    }

    const debitCents = moneyToCents(debitRaw);
    const creditCents = moneyToCents(creditRaw);

    if (debitCents === null && creditCents === null) {
      warnings.push(`Line ${lineNo}: no amount (debit or credit), skipping`);
      continue;
    }

    let amountCents = 0;
    if (debitCents !== null && debitCents !== 0) amountCents = debitCents;
    else if (creditCents !== null && creditCents !== 0) amountCents = -creditCents;
    else {
      warnings.push(`Line ${lineNo}: zero amount, skipping`);
      continue;
    }

    rows.push({
      posted_at_iso: isoDate,
      description,
      amount_cents: amountCents,
      raw_classification: classification || undefined,
    });
  }

  return { ok: true, rows, warnings };
}

// "5/2/2026" -> "2026-05-02"
function mdYyyyToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// "1,250.00" or ".50" or "$45.30" -> integer cents. Empty -> null.
function moneyToCents(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// The CSV contains things like "Health &amp; Fitness" — decode those.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
