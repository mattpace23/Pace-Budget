// Money formatting helpers.

export function centsToDollars(cents: number): number {
  return cents / 100;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Formats cents as a whole-dollar amount by default. Pass cents=true for cents precision.
export function formatMoney(cents: number, opts: { cents?: boolean } = {}): string {
  return opts.cents ? usdCents.format(cents / 100) : usd.format(cents / 100);
}

// Parses a user-entered string (e.g. "1,250", "$1,250.50") into cents.
// Returns null if it can't parse.
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
