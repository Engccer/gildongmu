import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { journeyTransferGuess, type JourneyTransferSide } from "../transfer-guess";
import type { Coord } from "../../types";

type Case = { name: string; place: Coord; origin: Coord | null; dest: Coord | null; expected: JourneyTransferSide };
const file = JSON.parse(
  readFileSync(join(__dirname, "../../__tests__/fixtures/journey-transfer-guess.json"), "utf8"),
) as { cases: Case[] };

describe("journeyTransferGuess(E77 판정 3) — Kit과 공유 fixture", () => {
  it("fixture가 비어 있지 않고 두 갈래를 모두 담는다", () => {
    expect(file.cases.map((c) => c.expected)).toEqual(expect.arrayContaining(["board", "alight"]));
  });
  for (const c of file.cases) {
    it(c.name, () => {
      expect(journeyTransferGuess(c.place, c.origin, c.dest)).toBe(c.expected);
    });
  }
});
