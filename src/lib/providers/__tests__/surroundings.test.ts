import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORY_GROUPS,
  DEFAULT_CATEGORY_GROUPS,
  normalizeSurroundingDoc,
} from "../surroundings";

describe("카테고리 세트", () => {
  it("기본 세트는 현행 10종 그대로다 — 둘러보기 회귀 0", () => {
    expect(DEFAULT_CATEGORY_GROUPS).toEqual(
      expect.arrayContaining([
        "CS2", "SW8", "FD6", "CE7", "BK9", "PM9", "HP8", "MT1", "PO3", "AT4",
      ]),
    );
    expect(DEFAULT_CATEGORY_GROUPS).toHaveLength(10);
  });

  it("전체 세트는 카카오 18종이고 학교(SC4)를 포함한다", () => {
    expect(ALL_CATEGORY_GROUPS).toHaveLength(18);
    expect(ALL_CATEGORY_GROUPS).toContain("SC4");
    expect(ALL_CATEGORY_GROUPS).toContain("PS3");
    expect(ALL_CATEGORY_GROUPS).toContain("CT1");
  });
});

describe("normalizeSurroundingDoc", () => {
  const doc = {
    id: "1",
    place_name: "서울신명초등학교",
    category_name: "교육 > 학교 > 초등학교",
    category_group_code: "SC4",
    x: "127.1501",
    y: "37.5417",
    road_address_name: "서울 강동구 명일로24길 33",
  };

  it("새 코드(SC4 학교)를 매핑한다", () => {
    const p = normalizeSurroundingDoc(doc, 37.5415, 127.1495);
    expect(p?.category).toBe("school");
  });

  it("도로명주소를 실어 보낸다 — M1 좌우 판정의 입력", () => {
    const p = normalizeSurroundingDoc(doc, 37.5415, 127.1495);
    expect(p?.roadAddress).toBe("서울 강동구 명일로24길 33");
  });

  it("도로명주소가 없으면 null (빈 문자열 금지)", () => {
    const p = normalizeSurroundingDoc(
      { ...doc, road_address_name: "" },
      37.5415,
      127.1495,
    );
    expect(p?.roadAddress).toBeNull();
  });
});
