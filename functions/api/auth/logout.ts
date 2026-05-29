import { clearedCookieHeader, isSecureRequest } from "../../lib/auth";

export const onRequestPost: PagesFunction = async (ctx) => {
  const secure = isSecureRequest(ctx.request);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearedCookieHeader({ secure }),
    },
  });
};
