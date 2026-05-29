// Lightweight HMAC-signed session token. No DB writes; the token IS the session.
// Cookie format: <issuedAtMs>.<hexHmac>. Valid for SESSION_TTL_MS.

export const AUTH_COOKIE = "pb_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(secret: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacHex(secret, issuedAt);
  return `${issuedAt}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  const [issuedAtStr, sig] = token.split(".");
  if (!issuedAtStr || !sig) return false;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > SESSION_TTL_MS) return false;
  const expected = await hmacHex(secret, issuedAtStr);
  return timingSafeEqual(sig, expected);
}

export function cookieHeader(
  value: string,
  maxAgeSeconds: number,
  opts: { secure: boolean } = { secure: true },
): string {
  const parts = [
    `${AUTH_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookieHeader(opts: { secure: boolean } = { secure: true }): string {
  const parts = [
    `${AUTH_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  // Local wrangler pages dev runs over HTTP on localhost. Everywhere else (real
  // Pages deploy or any non-localhost host) we set the Secure flag.
  const url = new URL(request.url);
  return url.protocol === "https:" || url.hostname !== "localhost";
}
