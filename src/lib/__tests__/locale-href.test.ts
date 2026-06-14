import { describe, it, expect } from "vitest";
import { withQuery } from "../locale-href";

describe("withQuery", () => {
  it("쿼리 문자열을 pathname에 결합한다", () => {
    expect(withQuery("/", "?q=서울역")).toBe("/?q=서울역");
  });
  it("빈 쿼리면 pathname만 반환", () => {
    expect(withQuery("/", "")).toBe("/");
  });
  it("물음표 없는 쿼리도 처리", () => {
    expect(withQuery("/place", "q=x")).toBe("/place?q=x");
  });
  it("이미 ?로 시작하면 중복 추가 안 함", () => {
    expect(withQuery("/place", "?q=x")).toBe("/place?q=x");
  });
});
