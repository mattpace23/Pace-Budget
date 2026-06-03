import type { ParserId, ParseResult } from "./types";
import { parseMainChecking } from "./main_checking";
import { parseChase } from "./chase";

export function parseByParserId(parserId: ParserId, csv: string): ParseResult {
  switch (parserId) {
    case "main_checking":
      return parseMainChecking(csv);
    case "chase_reserve":
    case "chase_amazon":
      return parseChase(csv);
  }
}

export type { ParsedRow, ParseResult, ParserId } from "./types";
