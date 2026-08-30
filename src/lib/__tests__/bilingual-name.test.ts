import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bilingualDisplay, bilingualName } from "../bilingual-name";

interface Case {
  id: string;
  locale: string;
  ko: string;
  en: string | null;
  roman: string | null;
  primary: string;
  secondary: string | null;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "bilingual-name-cases.json"), "utf8"),
) as { cases: Case[] };

describe("bilingualName (공유 fixture ↔ Kit BilingualNameTests)", () => {
  it("fixture가 비어 있지 않다", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of fixture.cases) {
    it(c.id, () => {
      expect(bilingualName(c.locale, c.ko, { en: c.en, roman: c.roman })).toEqual({
        primary: c.primary,
        secondary: c.secondary,
      });
    });
  }

  it("bilingualDisplay는 한 줄 괄호이고 병기 없으면 primary만", () => {
    expect(bilingualDisplay({ primary: "Seolleung", secondary: "선릉역" })).toBe(
      "Seolleung (선릉역)",
    );
    expect(bilingualDisplay({ primary: "CU", secondary: null })).toBe("CU");
  });
});
