import { describe, expect, it } from "vitest";
import { isNoRouteError, readOdsayError } from "../odsay-envelope";

describe("readOdsayError", () => {
  it("객체 봉투에서 code와 msg를 읽는다", () => {
    expect(readOdsayError({ code: "-98", msg: "출, 도착지가 700m이내입니다." })).toEqual({
      code: "-98",
      message: "출, 도착지가 700m이내입니다.",
    });
  });

  it("배열 봉투에서 첫 원소의 code와 message를 읽는다", () => {
    // 실호출 확정(2026-08-07 무효 키): 인증 실패는 배열 + message 키
    expect(readOdsayError([{ code: "500", message: "[ApiKeyAuthFailed] ..." }])).toEqual({
      code: "500",
      message: "[ApiKeyAuthFailed] ...",
    });
  });

  it("숫자 code를 문자열로 정규화한다", () => {
    expect(readOdsayError({ code: -98, msg: "x" })?.code).toBe("-98");
  });

  it("error가 없거나 빈 배열이면 null", () => {
    expect(readOdsayError(undefined)).toBeNull();
    expect(readOdsayError(null)).toBeNull();
    expect(readOdsayError([])).toBeNull();
  });

  it("코드가 없으면 null이 아니라 빈 코드로 읽어 throw 경로로 보낸다", () => {
    // 모양을 모르는 오류를 "경로 없음"으로 오분류하지 않는다
    expect(readOdsayError({ msg: "알 수 없음" })).toEqual({ code: "", message: "알 수 없음" });
    expect(isNoRouteError("")).toBe(false);
  });
});

describe("isNoRouteError", () => {
  it("-98만 경로 없음으로 본다", () => {
    expect(isNoRouteError("-98")).toBe(true);
    expect(isNoRouteError("500")).toBe(false);
  });
});
