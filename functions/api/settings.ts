// GET   /api/settings  → returns all settings as an object
// PATCH /api/settings  → upsert one or more settings

import { json, badRequest, serverError } from "../lib/db";

interface Env {
  DB: D1Database;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

// Known settings keys + how to validate them.
// Anything in this map is allowed via PATCH; anything else is rejected.
const VALIDATORS: Record<string, (v: unknown) => string | null> = {
  // The field name says cents, so the value IS already in cents — do NOT
  // multiply by 100 again. Accept a finite integer (or numeric string).
  savings_starting_balance_cents: (v) => {
    let cents: number | null = null;
    if (typeof v === "number" && Number.isFinite(v)) cents = Math.round(v);
    else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/[$,\s]/g, ""));
      cents = Number.isFinite(n) ? Math.round(n) : null;
    }
    if (cents === null || cents < 0) return null;
    return String(cents);
  },
  savings_starting_as_of_iso: (v) => {
    if (typeof v !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return v;
  },
  // SimpleFin: the user authorizes external cron callers with this shared secret.
  // A random ~32 char string is recommended.
  simplefin_cron_secret: (v) => {
    if (v === null) return ""; // allow clearing
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (trimmed.length > 0 && trimmed.length < 16) return null;
    return trimmed;
  },
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { results } = await ctx.env.DB.prepare(
      `SELECT key, value, updated_at FROM settings`,
    ).all<SettingRow>();
    const out: Record<string, string> = {};
    for (const r of results) out[r.key] = r.value;
    return json({ settings: out });
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest("invalid JSON");
  }

  if (!body || typeof body !== "object") return badRequest("expected an object");

  const updates: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(body)) {
    const validator = VALIDATORS[k];
    if (!validator) return badRequest(`unknown setting: ${k}`);
    const normalized = validator(v);
    if (normalized === null) return badRequest(`invalid value for ${k}`);
    updates.push({ key: k, value: normalized });
  }

  if (updates.length === 0) return badRequest("no settings to update");

  try {
    const statements = updates.map((u) =>
      ctx.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
      ).bind(u.key, u.value),
    );
    await ctx.env.DB.batch(statements);

    const { results } = await ctx.env.DB.prepare(
      `SELECT key, value, updated_at FROM settings`,
    ).all<SettingRow>();
    const out: Record<string, string> = {};
    for (const r of results) out[r.key] = r.value;
    return json({ settings: out });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
