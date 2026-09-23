import { describe, expect, it } from "vitest";
import cases from "./fixtures/station-layout-cases.json";
import { isRepresentativePhone, stationLayoutKind } from "../station-phone";
import { isStation } from "../station-match";

describe("stationLayoutKind (E44 spec §3.1, 공유 fixture)", () => {
  it.each(cases.layoutKind)("$note → $expected", ({ id, category, expected }) => {
    expect(stationLayoutKind({ id, category })).toBe(expected);
  });

  it("카카오 POI에서 역 레이아웃이면 넓은 isStation도 참이다 — 역 축(present)이 레이아웃과 어긋나지 않는다", () => {
    for (const c of cases.layoutKind.filter((c) => c.expected && !c.id.startsWith("transit-stop:"))) {
      expect(isStation({ name: "x", category: c.category } as Parameters<typeof isStation>[0])).toBe(true);
    }
  });
});

describe("isRepresentativePhone (판정 ⑥, 공유 fixture)", () => {
  it.each(cases.representativePhone)("$phone → $expected", ({ phone, expected }) => {
    expect(isRepresentativePhone(phone)).toBe(expected);
  });
});
