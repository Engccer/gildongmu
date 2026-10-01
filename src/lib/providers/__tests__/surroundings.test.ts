import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({ env: { KAKAO_REST_API_KEY: "test-key" } }));

import {
  ALL_CATEGORY_GROUPS,
  DEFAULT_CATEGORY_GROUPS,
  OUTING_CAP,
  findSurroundingsNear,
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

describe("findSurroundingsNear 호출 범위(E58 ②)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 카테고리마다 15건(거리 1m 간격, 코드별로 겹치지 않는 id)을 돌려주는 카카오 stub. */
  function stubKakao() {
    const codes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        const code = url.searchParams.get("category_group_code") ?? "";
        codes.push(code);
        const base = codes.length * 100;
        const documents = Array.from({ length: 15 }, (_, i) => ({
          id: `${code}-${i}`,
          place_name: `${code} ${i}`,
          category_name: "x",
          category_group_code: code,
          x: "127.1",
          y: "37.5",
          distance: String(base + i),
        }));
        return new Response(JSON.stringify({ documents }), { status: 200 });
      }),
    );
    return codes;
  }

  it("opts 없이는 기본 10종만 조회하고 상한 50 — 둘러보기 회귀 0", async () => {
    const codes = stubKakao();
    const out = await findSurroundingsNear(37.5, 127.1);
    expect([...codes].sort()).toEqual([...DEFAULT_CATEGORY_GROUPS].sort());
    expect(out).toHaveLength(50);
  });

  it("나들이 옵트인(18종·OUTING_CAP)은 18종 전부를 조회하고 가까운 순 100곳", async () => {
    const codes = stubKakao();
    const out = await findSurroundingsNear(37.5, 127.1, { groups: ALL_CATEGORY_GROUPS, cap: OUTING_CAP });
    expect([...codes].sort()).toEqual([...ALL_CATEGORY_GROUPS].sort());
    expect(OUTING_CAP).toBe(100);
    expect(out).toHaveLength(100);
    expect(out.every((p, i) => i === 0 || out[i - 1].distanceMeters <= p.distanceMeters)).toBe(true);
  });
});
