// Small helpers for working with D1 responses + JSON API shape.

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function badRequest(message: string): Response {
  return json({ error: "bad_request", message }, 400);
}

export function notFound(message = "not_found"): Response {
  return json({ error: "not_found", message }, 404);
}

export function serverError(message: string): Response {
  return json({ error: "server_error", message }, 500);
}

// Pull a finite integer out of arbitrary input (request body field, URL param).
export function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

// Dollars (as string or number) -> integer cents. "12.34" -> 1234, 12 -> 1200.
export function dollarsToCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === "string" && v.trim() !== "") {
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}
