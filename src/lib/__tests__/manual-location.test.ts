import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/manual-location-scenarios.json";
import {
  FIX_MAX_AGE_S,
  JUDGE_CEILING_M,
  MOVED_M,
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
