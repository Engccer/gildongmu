import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  buildKakaoRadiusSearchUrl,
  searchSubwayExitsKakao,
  searchTaxiStandsKakao,
} from "../kakao-local";

const COORD = { lat: 37.5665, lng: 126.978 };

function doc(id: string, name: string, category = "교통,수송 > 지하철,전철 > 지하철출구") {
  return {
    id,
    place_name: name,
    category_name: category,
    category_group_code: "",
    phone: "",
    address_name: "",
    road_address_name: "",
    x: "126.978",
    y: "37.5665",
    place_url: "",
    distance: "",
  };
}

/** 질의어 → 응답 문서. 없는 질의는 0건. */
function serve(table: Record<string, ReturnType<typeof doc>[]>) {
  fetchMock.mockImplementation(async (url: URL) => {
    const q = url.searchParams.get("query") ?? "";
    return { ok: true, json: async () => ({ documents: table[q] ?? [], meta: {} }) };
  });
}

function queried(): string[] {
  return fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get("query") ?? "");
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("buildKakaoRadiusSearchUrl", () => {
  it("query·size 15·좌표 4자리·radius를 싣는다", () => {
    const url = buildKakaoRadiusSearchUrl("강남역 1번출구", { lat: 37.497952, lng: 127.027619 }, 800);
    expect(url.searchParams.get("query")).toBe("강남역 1번출구");
    expect(url.searchParams.get("size")).toBe("15");
    expect(url.searchParams.get("x")).toBe("127.0276");
    expect(url.searchParams.get("y")).toBe("37.4980");
    expect(url.searchParams.get("radius")).toBe("800");
  });
});

describe("searchSubwayExitsKakao", () => {
  it("번호를 올리며 찾고 3번 연속 미발견이면 다음 묶음을 보내지 않는다", async () => {
    serve({
      "강남역 1번출구": [doc("1", "강남역 1번출구")],
      "강남역 2번출구": [doc("2", "강남역 2번출구")],
      "강남역 3번출구": [doc("3", "강남역 3번출구"), doc("31", "강남역 3-1번출구")],
    });
    const docs = await searchSubwayExitsKakao("강남", COORD);
    expect(docs.map((d) => d.place_name)).toEqual(["강남역 1번출구", "강남역 2번출구", "강남역 3번출구", "강남역 3-1번출구"]);
    // 첫 묶음 n=1..8만 — 4~8이 연속 미발견이라 9부터는 묻지 않는다.
    expect(queried()).toHaveLength(8);
  });

  it("발견이 이어지면 다음 묶음을 보내고 n ≤ 25에서 멈춘다", async () => {
    const table: Record<string, ReturnType<typeof doc>[]> = {};
    for (let n = 1; n <= 30; n++) table[`잠실역 ${n}번출구`] = [doc(String(n), `잠실역 ${n}번출구`)];
    serve(table);
    const docs = await searchSubwayExitsKakao("잠실", COORD);
    expect(docs).toHaveLength(25);
    expect(Math.max(...queried().map((q) => Number(q.match(/ (\d+)번출구/)?.[1])))).toBe(25);
  });

  it("다른 번호의 문서(11번)는 1번의 발견으로 치지 않는다", async () => {
    serve({ "강남역 1번출구": [doc("11", "강남역 11번출구")] });
    const docs = await searchSubwayExitsKakao("강남", COORD);
    // 발견 판정과 무관하게 원시 문서는 돌려준다(선정은 순수 계층 몫) — 다만 1~3이 미발견이라 묶음은 하나.
    expect(queried()).toHaveLength(8);
    expect(docs.map((d) => d.id)).toEqual(["11"]);
  });

  it("같은 문서가 두 질의에 나와도 한 번만 돌려준다", async () => {
    serve({
      "강남역 1번출구": [doc("1", "강남역 1번출구")],
      "강남역 2번출구": [doc("1", "강남역 1번출구"), doc("2", "강남역 2번출구")],
    });
    const docs = await searchSubwayExitsKakao("강남", COORD);
    expect(docs.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("노선이 붙은 출구 이름(노량진역 1호선 9번출구)도 발견으로 친다", async () => {
    const table: Record<string, ReturnType<typeof doc>[]> = {};
    for (let n = 1; n <= 10; n++) table[`노량진역 ${n}번출구`] = [doc(String(n), `노량진역 ${n <= 2 || n === 9 ? "1호선" : "9호선"} ${n}번출구`)];
    serve(table);
    const docs = await searchSubwayExitsKakao("노량진", COORD);
    expect(docs).toHaveLength(10);
  });

  it("HTTP 실패는 throw한다(3-state: 조회 실패 ≠ 출구 없음)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    await expect(searchSubwayExitsKakao("강남", COORD)).rejects.toThrow(/카카오 출구 검색 실패/);
  });

  it("질의는 반경 800m·카카오 캐시 상한 300초다", async () => {
    serve({});
    await searchSubwayExitsKakao("강남", COORD);
    const [url, init] = fetchMock.mock.calls[0];
    expect((url as URL).searchParams.get("radius")).toBe("800");
    expect(init.next).toEqual({ revalidate: 300 });
  });
});

describe("searchTaxiStandsKakao", () => {
  it("두 질의를 반경 500으로 보내고 문서를 합친다(중복 제거)", async () => {
    serve({
      "서울역 택시승강장": [doc("a", "서울역택시승강장", "교통,수송 > 교통시설 > 택시")],
      택시승강장: [doc("a", "서울역택시승강장", "교통,수송 > 교통시설 > 택시"), doc("b", "택시승강장", "교통,수송 > 교통시설")],
    });
    const docs = await searchTaxiStandsKakao("서울", COORD);
    expect(queried().sort()).toEqual(["서울역 택시승강장", "택시승강장"]);
    expect(fetchMock.mock.calls.every(([u]) => (u as URL).searchParams.get("radius") === "500")).toBe(true);
    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
  });
});
