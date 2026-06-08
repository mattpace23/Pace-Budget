// Runs before every Pages Function request. Protects /api/* (except /api/auth/*)
// by requiring the session cookie set by /api/auth/login.

import { verifySession, AUTH_COOKIE } from "./lib/auth";

interface Env {
  DB: D1Database;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  SIMPLEFIN_CRON_SECRET?: string;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);

  // Only guard /api/* routes; static assets are served by Pages directly.
  if (!url.pathname.startsWith("/api/")) {
    return ctx.next();
  }

  // Only login and logout are public; /api/auth/me requires a valid session
  // (that's how the frontend checks "am I logged in?").
  if (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/logout") {
    return ctx.next();
  }

  // SimpleFin sync can be called by external cron with a shared secret.
  // Secret resolution order: SIMPLEFIN_CRON_SECRET env var (preferred — set in
  // Cloudflare Pages settings as Encrypted) → simplefin_cron_secret setting
  // (fallback). Cron sends the value as ?secret=... or X-Cron-Secret header.
  if (url.pathname === "/api/simplefin/sync") {
    const provided =
      url.searchParams.get("secret") ||
      ctx.request.headers.get("X-Cron-Secret") ||
      "";
    if (provided) {
      let expected = ctx.env.SIMPLEFIN_CRON_SECRET ?? "";
      if (!expected) {
        const setting = await ctx.env.DB.prepare(
          `SELECT value FROM settings WHERE key = ?`,
        )
          .bind("simplefin_cron_secret")
          .first<{ value: string }>();
        expected = setting?.value ?? "";
      }
      if (expected && timingSafeEqual(provided, expected)) {
        return ctx.next();
      }
    }
  }

  const cookie = ctx.request.headers.get("Cookie") || "";
  const token = cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${AUTH_COOKIE}=`))
    ?.slice(AUTH_COOKIE.length + 1);

  const ok = token && (await verifySession(token, ctx.env.SESSION_SECRET || ""));
  if (!ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return ctx.next();
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
