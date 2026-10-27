import { describe, it, expect, vi } from "vitest";
import { searchJourneyStops, type StopSearchDeps } from "../stop-search";
import type { JourneyStopHit } from "../../types";

const hit = (name: string, lat: number, lng: number, source: "seoul" | "tago" = "seoul"): JourneyStopHit => ({ name, lat, lng, source });
const SEOUL = { lat: 37.5665, lng: 126.978 };
const BUSAN = { lat: 35.158, lng: 129.06 };

function deps(over: Partial<StopSearchDeps> = {}): StopSearchDeps {
  return {
    region: vi.fn(async (c) => (c.lat > 36 ? { province: "서울특별시", city: "중구" } : { province: "부산광역시", city: "부산진구" })),
    nearbyCityCodes: vi.fn(async () => []),
    searchSeoul: vi.fn(async () => []),
    searchTago: vi.fn(async () => ({ stops: [], truncated: false })),
    ...over,
  };
}

describe("searchJourneyStops", () => {
  it("서울 좌표는 TOPIS만 부르고 근접 정류소 조회를 하지 않는다", async () => {
    const d = deps({ searchSeoul: vi.fn(async () => [hit("시청.덕수궁", 37.5663, 126.9769)]) });
    const r = await searchJourneyStops("덕수궁", [SEOUL], d);
    expect(r).toEqual({ stops: [hit("시청.덕수궁", 37.5663, 126.9769)] });
    expect(d.nearbyCityCodes).not.toHaveBeenCalled();
    expect(d.searchTago).not.toHaveBeenCalled();
  });

  it("부산 좌표는 표의 21과 근접 정류소의 코드를 중복 없이 대상으로 삼는다(담양·화순류)", async () => {
    const d = deps({ nearbyCityCodes: vi.fn(async () => ["21", "24"]) });
    await searchJourneyStops("서면", [BUSAN], d);
    const codes = vi.mocked(d.searchTago).mock.calls.map((c) => c[0]).sort();
    expect(codes).toEqual(["21", "24"]);
  });

  it("정렬은 두 좌표 중 가까운 쪽까지의 거리순", async () => {
    const d = deps({
      searchSeoul: vi.fn(async () => [hit("먼곳", 37.7, 127.1), hit("가까운곳", 37.5666, 126.9781)]),
    });
    const r = await searchJourneyStops("정류장", [SEOUL], d);
    expect(r.stops.map((s) => s.name)).toEqual(["가까운곳", "먼곳"]);
  });

  it("길 건너 같은 이름(500m 안)은 가까운 하나만 싣고, 500m 밖이면 둘 다 싣는다", async () => {
    const d = deps({
      searchSeoul: vi.fn(async () => [
        hit("강남역.삼성전자", 37.5666, 126.9781),
        hit("강남역", 37.567, 126.9785),
        hit("강남역", 37.58, 126.99),
      ]),
    });
    const r = await searchJourneyStops("강남역", [SEOUL], d);
    expect(r.stops.map((s) => s.name)).toEqual(["강남역.삼성전자", "강남역"]);
    expect(r.stops[1].lat).toBe(37.58);
  });

  it("빈 키 이름(점·괄호뿐)은 500m 안이어도 서로 합치지 않는다", async () => {
    const d = deps({ searchSeoul: vi.fn(async () => [hit(".", 37.5666, 126.9781), hit("(가)", 37.5667, 126.9782)]) });
    expect((await searchJourneyStops("정류장", [SEOUL], d)).stops).toHaveLength(2);
  });

  it("지역은 알았으나 표가 null이고 근접 조회가 throw면 failed이지 unsearched가 아니다(nearOk 항)", async () => {
    const d = deps({
      region: vi.fn(async () => ({ province: "강원특별자치도", city: "강릉시" })),
      nearbyCityCodes: vi.fn(async () => { throw new Error("x"); }),
      searchSeoul: vi.fn(async () => [hit("a", 37.5, 127)]),
    });
    const r = await searchJourneyStops("강릉", [SEOUL, BUSAN], { ...d, region: vi.fn()
      .mockResolvedValueOnce({ province: "서울특별시", city: "중구" })
      .mockResolvedValueOnce({ province: "강원특별자치도", city: "강릉시" }) });
    expect(r.failed).toBe(true);
    expect(r.unsearched).toBeUndefined();
  });

  it("역지오코딩이 실패한 좌표도 근접 정류소 코드로 검색한다", async () => {
    const d = deps({
      region: vi.fn(async () => null),
      nearbyCityCodes: vi.fn(async () => ["21"]),
      searchTago: vi.fn(async () => ({ stops: [hit("서면", 35.1581, 129.0601, "tago")], truncated: false })),
    });
    const r = await searchJourneyStops("서면", [BUSAN], d);
    expect(d.searchTago).toHaveBeenCalledWith("21", "서면");
    expect(r.failed).toBe(true);
    expect(r.stops).toHaveLength(1);
  });

  it("이름 검색이 하나도 성공하지 못하고 실패가 있으면 throw(유도는 성공해도)", async () => {
    const d = deps({ searchSeoul: vi.fn(async () => { throw new Error("x"); }) });
    await expect(searchJourneyStops("시청", [SEOUL], d)).rejects.toThrow();
  });

  it("상위 10건만 싣는다", async () => {
    const many = Array.from({ length: 15 }, (_, i) => hit(`정류장${i}`, 37.5665 + i * 0.01, 126.978));
    const r = await searchJourneyStops("정류장", [SEOUL], deps({ searchSeoul: vi.fn(async () => many) }));
    expect(r.stops).toHaveLength(10);
  });

  it("정상 0건은 빈 stops만(unsearched·failed 없음)", async () => {
    expect(await searchJourneyStops("없는이름", [SEOUL], deps())).toEqual({ stops: [] });
  });

  it("표에도 근접 정류소에도 도시코드가 없으면 unsearched", async () => {
    const d = deps({ region: vi.fn(async () => ({ province: "강원특별자치도", city: "강릉시" })) });
    expect(await searchJourneyStops("강릉", [SEOUL], d)).toEqual({ stops: [], unsearched: true });
  });

  it("역지오코딩 null은 failed이지 unsearched가 아니다(카카오 장애가 미제공으로 위장 금지)", async () => {
    const d = deps({
      region: vi.fn()
        .mockResolvedValueOnce({ province: "서울특별시", city: "중구" })
        .mockResolvedValueOnce(null),
      searchSeoul: vi.fn(async () => [hit("시청", 37.5663, 126.9769)]),
    });
    const r = await searchJourneyStops("시청", [SEOUL, BUSAN], d);
    expect(r.failed).toBe(true);
    expect(r.unsearched).toBeUndefined();
    expect(r.stops).toHaveLength(1);
  });

  it("근접 정류소 조회가 throw면 failed", async () => {
    const d = deps({ nearbyCityCodes: vi.fn(async () => { throw new Error("x"); }) });
    const r = await searchJourneyStops("서면", [BUSAN], d);
    expect(r.failed).toBe(true);
    expect(r.unsearched).toBeUndefined();
  });

  it("한 도시 검색만 실패하면 나머지는 싣고 failed", async () => {
    const d = deps({
      nearbyCityCodes: vi.fn(async () => ["24"]),
      searchTago: vi.fn(async (code: string) => {
        if (code === "24") throw new Error("x");
        return { stops: [hit("서면", 35.1581, 129.0601, "tago")], truncated: false };
      }),
    });
    const r = await searchJourneyStops("서면", [BUSAN], d);
    expect(r.failed).toBe(true);
    expect(r.stops).toHaveLength(1);
  });

  it("TAGO 페이지 상한(truncated)을 전달한다", async () => {
    const d = deps({ searchTago: vi.fn(async () => ({ stops: [], truncated: true })) });
    expect((await searchJourneyStops("서면", [BUSAN], d)).truncated).toBe(true);
  });

  it("대상 유도와 검색이 전부 실패하면 throw", async () => {
    const d = deps({ region: vi.fn(async () => null), nearbyCityCodes: vi.fn(async () => { throw new Error("x"); }) });
    await expect(searchJourneyStops("서면", [BUSAN], d)).rejects.toThrow();
  });
});
