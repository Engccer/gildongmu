import { describe, it, expect } from "vitest";
import { roundCoord } from "../coord-round";

describe("roundCoord", () => {
  it("지정 자리수로 반올림한 문자열을 반환한다", () => {
    expect(roundCoord(127.12345678, 4)).toBe("127.1235");
    expect(roundCoord(37.5, 4)).toBe("37.5000"); // toFixed라 자리수 고정, 키 안정성
    expect(roundCoord(127.0009, 3)).toBe("127.001");
  });
});
