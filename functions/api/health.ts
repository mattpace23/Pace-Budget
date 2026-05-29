interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  let dbStatus = "unknown";
  try {
    const r = await ctx.env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    dbStatus = r?.ok === 1 ? "connected" : "responded_unexpected";
  } catch (e) {
    dbStatus = `error: ${(e as Error).message}`;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      db: dbStatus,
      now: new Date().toISOString(),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
