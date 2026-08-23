import { describe, expect, it } from "vitest";
import { parseRoadNameEn } from "../juso-road-name";

describe("parseRoadNameEn", () => {
  it("선행 건물번호 토큰 하나만 벗긴다", () => {
    expect(parseRoadNameEn("975 Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
    expect(parseRoadNameEn("2-1 Jinhwangdo-ro, Gangdong-gu, Seoul")).toBe("Jinhwangdo-ro");
  });

  it("번호 토큰은 순수 숫자가 아닐 수 있다(실측 B102)", () => {
    expect(parseRoadNameEn("B102 Bongeunsa-ro, Gangnam-gu, Seoul")).toBe("Bongeunsa-ro");
  });

  it("이름 안의 번호(6-gil)는 남긴다 — 첫 토큰만 벗기기 때문", () => {
    expect(parseRoadNameEn("11 Seongnae-ro 6-gil, Gangdong-gu, Seoul")).toBe("Seongnae-ro 6-gil");
  });

  it("번호가 없으면 그대로", () => {
    expect(parseRoadNameEn("Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
  });

  it("빈 값·번호만 있는 값은 null", () => {
    expect(parseRoadNameEn("")).toBeNull();
    expect(parseRoadNameEn("975 ")).toBeNull();
  });
});
