import { describe, it, expect } from "vitest";
import { coordParam, latParam, lngParam } from "../coord-param";

describe("coordParam", () => {
  it("정상 좌표 문자열을 숫자로 변환한다", () => {
    expect(latParam().parse("37.535")).toBe(37.535);
    expect(lngParam().parse("127.140")).toBe(127.14);
  });

  it("빈 문자열은 라벨 포함 한국어 사유로 거부한다 (누락이 0으로 위장하지 않는다)", () => {
    const r = latParam().safeParse("");
    expect(!r.success && r.error.issues[0].message).toContain("위도");
  });

  it("숫자가 아니면 라벨 포함 한국어 사유를 준다 (NaN이 라벨 없는 기본 메시지로 새지 않는다)", () => {
    const r = latParam().safeParse("oops");
    expect(!r.success && r.error.issues[0].message).toContain("위도");
  });

  it("비유한값(Infinity)도 같은 라벨 사유로 거부한다", () => {
    const r = latParam().safeParse("Infinity");
    expect(!r.success && r.error.issues[0].message).toContain("위도");
  });

  it("범위 밖은 라벨 포함 사유로 거부한다", () => {
    const r = latParam().safeParse("91");
    expect(!r.success && r.error.issues[0].message).toContain("위도");
    expect(coordParam(-180, 180).safeParse("181").success).toBe(false);
  });

  it("선택 좌표 관례(optional().catch(undefined))에서 누락은 undefined가 된다", () => {
    const schema = latParam().optional().catch(undefined);
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse("")).toBeUndefined();
  });
});
