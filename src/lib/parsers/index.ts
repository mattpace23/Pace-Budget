import type { ParserId, ParseResult } from "./types";
import { parseMainChecking } from "./main_checking";

export function parseByParserId(parserId: ParserId, csv: string): ParseResult {
  switch (parserId) {
    case "main_checking":
      return parseMainChecking(csv);
    case "chase_reserve":
    case "chase_amazon":
      return {
        ok: false,
        error: `Parser "${parserId}" not yet implemented (coming in Phase 8)`,
      };
  }
}

export type { ParsedRow, ParseResult, ParserId } from "./types";
