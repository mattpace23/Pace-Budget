// Shared helpers used by every bank CSV parser.

// "5/2/2026" or "05/02/2026" → "2026-05-02". Null on bad input.
export function mdYyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// "1,250.00", ".50", "$45.30", "-34.04" → integer cents. Returns null on bad input.
export function moneyToCents(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// Decode common HTML entities seen in bank CSVs (e.g. "Health &amp; Fitness").
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Strip the UTF-8 BOM if a file starts with it. Some bank exports include one.
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
