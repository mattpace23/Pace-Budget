import { json, serverError } from "../lib/db";

interface Env {
  DB: D1Database;
}

interface AccountRow {
  id: number;
  name: string;
  kind: "checking" | "credit_card";
  parser: "main_checking" | "chase_reserve" | "chase_amazon";
  created_at: number;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const { results } = await ctx.env.DB.prepare(
      `SELECT id, name, kind, parser, created_at FROM accounts ORDER BY id ASC`,
    ).all<AccountRow>();
    return json({ accounts: results });
  } catch (e) {
    return serverError((e as Error).message);
  }
};
