// Runs before every Pages Function request. Protects /api/* (except /api/auth/*)
// by requiring the session cookie set by /api/auth/login.

import { verifySession, AUTH_COOKIE } from "./lib/auth";

interface Env {
  DB: D1Database;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
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
