import { describe, expect, it } from "vitest";
import seed from "../data/subway-stations.json";
import { subwayOperatorNameEn } from "../subway-operator-names";

/** 운영기관명 영문 표 drift 가드 — seed `operator` 고유값 전수가 표에 있어야 en 역 정보 줄이 한 언어로 남는다. */
describe("subway-operator-names drift", () => {
  it("seed 운영기관 전수가 표에 있다", () => {
    const operators = [...new Set((seed as { operator: string }[]).map((s) => s.operator))];
    const missing = operators.filter((o) => subwayOperatorNameEn(o) === null);
    expect(missing).toEqual([]);
  });

  it("미지 입력은 null", () => {
    expect(subwayOperatorNameEn("없는공사")).toBeNull();
    expect(subwayOperatorNameEn(undefined)).toBeNull();
  });
});
