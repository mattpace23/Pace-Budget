// If the middleware let the request through, the session is valid.
export const onRequestGet: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
