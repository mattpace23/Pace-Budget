// SimpleFin Bridge client. Docs: https://www.simplefin.org/protocol.html
//
// Auth model:
//   1. User signs up at simplefin.org and gets a one-time "setup token" (a URL).
//   2. The setup token is POSTed to itself; response body is the permanent
//      "access URL" — a URL with HTTP Basic Auth embedded
//      (https://username:password@bridge.simplefin.org/simplefin).
//   3. The access URL is used for all subsequent reads.
//
// Sign convention:
//   SimpleFin amount string: negative = money out (purchase), positive = money in.
//   Our schema:               positive = money out, negative = money in.
//   simplefinAmountToCents flips the sign.

export interface SimpleFinTransaction {
  id: string;
  posted: number; // unix timestamp (seconds)
  amount: string; // decimal as string, e.g., "-34.56"
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SimpleFinAccount {
  org: { name: string; url?: string; domain?: string };
  id: string;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions: SimpleFinTransaction[];
}

export interface SimpleFinResponse {
  errors: string[];
  accounts: SimpleFinAccount[];
}

export interface FetchOptions {
  startDate?: number; // unix seconds
  endDate?: number;
  pending?: boolean;
  balancesOnly?: boolean;
}

// Exchange a one-time setup token for the permanent access URL.
// The setup token is itself a URL; POSTing to it returns the access URL as text.
export async function exchangeSetupToken(setupToken: string): Promise<string> {
  const trimmed = setupToken.trim();
  // SimpleFin distributes setup tokens base64-encoded. If it doesn't look like
  // a URL, try decoding.
  let url: string;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    url = trimmed;
  } else {
    try {
      url = atob(trimmed).trim();
    } catch {
      throw new Error(
        "Setup token isn't a URL or base64-encoded URL. Paste the exact token SimpleFin gave you.",
      );
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Decoded setup token isn't a valid URL.");
    }
  }

  const r = await fetch(url, { method: "POST" });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SimpleFin setup-token exchange failed (${r.status}): ${body}`);
  }
  const accessUrl = (await r.text()).trim();
  if (!accessUrl.startsWith("http://") && !accessUrl.startsWith("https://")) {
    throw new Error(`SimpleFin returned an unexpected access URL: ${accessUrl}`);
  }
  return accessUrl;
}

// Fetch accounts (with transactions, optionally) from SimpleFin.
export async function fetchAccounts(
  accessUrl: string,
  opts: FetchOptions = {},
): Promise<SimpleFinResponse> {
  let url: URL;
  try {
    url = new URL(accessUrl);
  } catch {
    throw new Error(
      "SimpleFin access URL is malformed. Check the URL you saved in settings.",
    );
  }

  // SimpleFin's /accounts is the endpoint we want.
  if (!url.pathname.endsWith("/accounts")) {
    url.pathname = url.pathname.replace(/\/$/, "") + "/accounts";
  }

  if (opts.startDate) url.searchParams.set("start-date", String(opts.startDate));
  if (opts.endDate) url.searchParams.set("end-date", String(opts.endDate));
  if (opts.pending !== undefined) {
    url.searchParams.set("pending", opts.pending ? "1" : "0");
  }
  if (opts.balancesOnly) url.searchParams.set("balances-only", "1");

  // Extract Basic Auth and send as header (some fetch impls strip embedded creds).
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";

  const auth = btoa(`${username}:${password}`);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`SimpleFin returned ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = (await r.json()) as SimpleFinResponse;
  return data;
}

// SimpleFin amount string → integer cents in our schema convention.
// "-34.56" (purchase, money out) → +3456 (positive = money out in our schema).
// "12.34"  (deposit, money in)   → -1234 (negative = money in in our schema).
export function simplefinAmountToCents(amount: string): number {
  const dollars = parseFloat(amount);
  if (!Number.isFinite(dollars)) return 0;
  return -Math.round(dollars * 100);
}

// SimpleFin unix timestamp → YYYY-MM-DD (UTC).
// Banks post transactions with their own date semantics; we just use the UTC
// date of the timestamp. Edge cases at midnight may show a 1-day shift but
// over a month that nets out.
export function simplefinDateToIso(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
