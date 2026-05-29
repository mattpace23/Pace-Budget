import { issueSession, cookieHeader, isSecureRequest } from "../../lib/auth";

interface Env {
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.APP_PASSWORD || !ctx.env.SESSION_SECRET) {
    return json({ error: "server_not_configured" }, 500);
  }

  let body: { password?: string };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (typeof body.password !== "string" || body.password.length === 0) {
    return json({ error: "bad_request" }, 400);
  }

  // Constant-time-ish compare. Both strings are short and this is a single shared
  // password, so the timing attack surface is minimal but we still try.
  const expected = ctx.env.APP_PASSWORD;
  if (
    body.password.length !== expected.length ||
    !timingSafeEqual(body.password, expected)
  ) {
    // Mild rate-limit by sleeping briefly on failure.
    await new Promise((r) => setTimeout(r, 250));
    return json({ error: "invalid_password" }, 401);
  }

  const token = await issueSession(ctx.env.SESSION_SECRET);
  const secure = isSecureRequest(ctx.request);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieHeader(token, 60 * 60 * 24 * 30, { secure }),
    },
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
