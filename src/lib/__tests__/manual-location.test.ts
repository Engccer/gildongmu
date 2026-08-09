import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/manual-location-scenarios.json";
import {
  FIX_MAX_AGE_S,
  JUDGE_CEILING_M,
  MOVED_M,
  isManualLocationVerified,
  judgeManualLocation,
  parseManualLocation,
  type Fix,
  type ManualLocation,
} from "../manual-location";

describe("judgeManualLocation — 공유 fixture", () => {
  for (const c of scenarios.cases) {
    it(c.name, () => {
      const verdict = judgeManualLocation(
        c.manual as ManualLocation,
        c.fix as Fix | null,
        c.now,
      );
      expect(verdict).toBe(c.expect);
    });
  }
});

describe("상수", () => {
  it("두 100m는 축이 달라 별도 선언이다", () => {
    // 값이 같다는 이유로 하나로 합치면 한 축만 조정하려다 둘 다 바뀐다.
    expect(MOVED_M).toBe(100);
    expect(JUDGE_CEILING_M).toBe(100);
    expect(FIX_MAX_AGE_S).toBe(10);
  });
});

describe("parseManualLocation — 저장 경계 검증", () => {
  const valid: ManualLocation = {
    revision: 3,
    label: "길동 카페",
    lat: 37.5384,
    lng: 127.1432,
    origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1000 },
    setAt: 1000,
  };

  it("정상값을 통과시킨다", () => {
    expect(parseManualLocation(valid)).toEqual(valid);
  });

  it("origin이 null이어도 통과시킨다", () => {
    const noOrigin = { ...valid, origin: null };
    expect(parseManualLocation(noOrigin)).toEqual(noOrigin);
  });

  it.each([
    ["문자열 좌표", { ...valid, lat: "37.5" }],
    ["NaN 좌표", { ...valid, lat: Number.NaN }],
    ["범위 밖 위도", { ...valid, lat: 91 }],
    ["범위 밖 경도", { ...valid, lng: 181 }],
    ["공백뿐인 label", { ...valid, label: "   " }],
    ["origin 정확도 0", { ...valid, origin: { ...valid.origin!, accuracy: 0 } }],
    ["origin 정확도 음수", { ...valid, origin: { ...valid.origin!, accuracy: -5 } }],
    ["revision 누락", { ...valid, revision: undefined }],
    ["객체가 아님", "길동"],
    ["null", null],
  ])("%s를 폐기한다", (_name, raw) => {
    expect(parseManualLocation(raw)).toBeNull();
  });
});

/**
 * 라벨 판정선(I1). `GildongmuKit`의 `검증_가능형_라벨은_origin과_마지막_판정을_모두_본다`와
 * **같은 표**다 — 두 플랫폼이 같은 것을 약속해야 한다.
 */
describe("isManualLocationVerified", () => {
  const base: ManualLocation = {
    revision: 1, label: "길동 카페", lat: 37.5384, lng: 127.1432,
    origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
  };
  const noOrigin: ManualLocation = { ...base, origin: null };

  it("origin이 있고 아직 판정 전이면 검증 가능형", () => {
    expect(isManualLocationVerified(base, null)).toBe(true);
  });

  it("origin이 있고 keep이면 검증 가능형", () => {
    expect(isManualLocationVerified(base, "keep")).toBe(true);
  });

  it("origin이 있어도 undecidable이면 검증 불가형", () => {
    // 권한 철회·실내 측위 실패. 여기서 true를 내면 더 나쁜 상태가 더 안심시키는
    // 라벨을 받는 역전이 된다(spec §4.5).
    expect(isManualLocationVerified(base, "undecidable")).toBe(false);
  });

  it("origin이 없으면 어떤 판정에서도 검증 불가형", () => {
    expect(isManualLocationVerified(noOrigin, null)).toBe(false);
    expect(isManualLocationVerified(noOrigin, "keep")).toBe(false);
    expect(isManualLocationVerified(noOrigin, "undecidable")).toBe(false);
  });
});
