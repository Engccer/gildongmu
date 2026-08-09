import { describe, expect, it } from "vitest";
import { parseRoadAddress, isOddSide } from "../road-address";

describe("parseRoadAddress", () => {
  it("시·도 접두가 있는 도로명주소를 도로명·본번으로 가른다", () => {
    expect(parseRoadAddress("서울특별시 강동구 명일로24길 25")).toEqual({
      road: "명일로24길",
      main: 25,
      sub: null,
    });
  });

  it("부번을 분리한다", () => {
    expect(parseRoadAddress("서울 강동구 명일로 200-16")).toEqual({
      road: "명일로",
      main: 200,
      sub: 16,
    });
  });

  it("'대로'·'로'·'길' 세 접미를 모두 받는다", () => {
    expect(parseRoadAddress("서울 강동구 천호대로 1201")?.road).toBe("천호대로");
    expect(parseRoadAddress("서울 강동구 성내로 25")?.road).toBe("성내로");
    expect(parseRoadAddress("서울 강동구 명일로24길 33")?.road).toBe("명일로24길");
  });

  it("지하 표기를 건물번호로 오인하지 않는다", () => {
    expect(parseRoadAddress("서울 서초구 신반포로 지하 188")).toEqual({
      road: "신반포로",
      main: 188,
      sub: null,
    });
  });

  it("도로명주소가 아니면 null", () => {
    expect(parseRoadAddress("서울 강동구 길동 470")).toBeNull();
    expect(parseRoadAddress("")).toBeNull();
  });
});

describe("isOddSide", () => {
  it("홀수 본번은 도로 진행 왼쪽이다", () => {
    expect(isOddSide({ road: "성내로", main: 25, sub: null })).toBe(true);
    expect(isOddSide({ road: "성내로", main: 22, sub: null })).toBe(false);
  });
});
