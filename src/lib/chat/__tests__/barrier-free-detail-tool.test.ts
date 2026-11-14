import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

vi.mock("@/lib/providers/tour-barrier-free", async (orig) => ({
  // normalizeName은 순수 함수라 실물을 쓴다(앵커 이름과 같은지 판정).
  normalizeName: (await orig<typeof import("@/lib/providers/tour-barrier-free")>()).normalizeName,
  getBarrierFreeDetail: vi.fn(),
  searchBarrierFreeNearby: vi.fn(),
  findBarrierFreeByName: vi.fn(),
}));
vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));

import { executeFunction } from "../router";
import { findBarrierFreeByName, getBarrierFreeDetail } from "@/lib/providers/tour-barrier-free";
import { searchPlaces } from "@/lib/providers/places";

const mockDetail = vi.mocked(getBarrierFreeDetail);
const mockByName = vi.mocked(findBarrierFreeByName);
const mockSearch = vi.mocked(searchPlaces);
const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko" };

const DETAIL = {
  contentId: "126508",
  name: "경복궁",
  facilities: [{ key: "wheelchair", label: "휠체어 대여", value: "안내소에서 대여 가능" }],
};

describe("get_barrier_free_detail (채팅 도구, K3 ⑦)", () => {
  beforeEach(() => {
    mockDetail.mockReset();
    mockDetail.mockResolvedValue(DETAIL);
  });

  it("contentId로 조회하고 상세를 그대로 넘긴다 — 카드 없음, 출처 TourAPI", async () => {
    const r = await executeFunction("get_barrier_free_detail", { contentId: "126508" }, ctx);
    expect(mockDetail).toHaveBeenCalledWith("126508");
    expect(r.data).toEqual({ detail: DETAIL });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tourapi" }]);
  });

  it("빈 name은 싣지 않는다 — detailWithTour2가 title을 주지 않는다(실호출)", async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, name: "" });
    const r = await executeFunction("get_barrier_free_detail", { contentId: "126508" }, ctx);
    expect(r.data).toEqual({ detail: { contentId: "126508", facilities: DETAIL.facilities } });
  });

  it("항목 없음은 detail:null — 빈 facilities와 구분", async () => {
    mockDetail.mockResolvedValue(null);
    const r = await executeFunction("get_barrier_free_detail", { contentId: "0" }, ctx);
    expect(r.data).toEqual({ detail: null });
  });

  it("contentId가 비면 upstream을 부르지 않는다", async () => {
    const r = await executeFunction("get_barrier_free_detail", {}, ctx);
    expect(mockDetail).not.toHaveBeenCalled();
    expect((r.data as { error?: string }).error).toBeTruthy();
  });
});

describe("get_barrier_free_detail — 이름으로 찾기(E88 spec B2)", () => {
  const GYEONGBOK = { lat: 37.5796, lng: 126.977, name: "경복궁", roadAddress: "서울 종로구 사직로 161" };
  const DEOKSU = { lat: 37.5658, lng: 126.9752, name: "덕수궁" };
  const FUKUOKA = { lat: 33.5902, lng: 130.4017, name: "후쿠오카" };
  const anchorCtx: ExecutionContext = { ...ctx, placeAnchor: { lat: DEOKSU.lat, lng: DEOKSU.lng, name: "덕수궁" } };

  beforeEach(() => {
    mockDetail.mockReset();
    mockByName.mockReset();
    mockByName.mockResolvedValue({ detail: DETAIL, similar: [] });
    mockSearch.mockReset();
    mockSearch.mockImplementation(async ({ query }) => ({
      places: query === "경복궁" ? [GYEONGBOK] : query === "덕수궁" ? [DEOKSU] : query === "후쿠오카" ? [FUKUOKA] : [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
  });

  it("찾음: 장소 검색 첫 결과의 좌표와 두 이름(말한 이름, 검색이 준 이름)으로 찾고 고른 장소를 싣는다", async () => {
    const r = await executeFunction("get_barrier_free_detail", { name: "경복궁" }, ctx);
    expect(mockByName).toHaveBeenCalledWith(expect.objectContaining({ lat: GYEONGBOK.lat, lng: GYEONGBOK.lng, names: ["경복궁", "경복궁"] }));
    expect(r.data).toEqual({ matched: true, searchedPlace: "경복궁 (서울 종로구 사직로 161)", detail: DETAIL });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tourapi" }]);
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it("찾지 못함: matched:false와 안내 문장 — 「등록된 정보가 없음」이지 「편의시설이 없음」이 아니다", async () => {
    mockByName.mockResolvedValue({ detail: null, similar: [] });
    const r = await executeFunction("get_barrier_free_detail", { name: "경복궁" }, ctx);
    expect(r.data.matched).toBe(false);
    expect(r.data.searchedPlace).toBe("경복궁 (서울 종로구 사직로 161)");
    expect(String(r.data.notice)).toContain("편의시설이 없다는 뜻이 아니라");
    expect("detail" in r.data).toBe(false);
    expect("similar" in r.data).toBe(false);
  });

  it("찾지 못함 + 근처의 다른 등록 장소: similar를 싣는다", async () => {
    const similar = [{ name: "덕수궁 대한문", distanceMeters: 120 }];
    mockByName.mockResolvedValue({ detail: null, similar });
    const r = await executeFunction("get_barrier_free_detail", { name: "덕수궁" }, ctx);
    expect(r.data).toMatchObject({ matched: false, similar });
  });

  it("찾았는데 편의시설 항목이 없음: matched:true + 빈 facilities(못 찾음과 다른 모양)", async () => {
    mockByName.mockResolvedValue({ detail: { ...DETAIL, facilities: [] }, similar: [] });
    const r = await executeFunction("get_barrier_free_detail", { name: "경복궁" }, ctx);
    expect(r.data).toMatchObject({ matched: true, detail: { facilities: [] } });
  });

  it("조회 실패는 던진다", async () => {
    mockByName.mockRejectedValue(new Error("무장애 여행 정보 HTTP 500"));
    await expect(executeFunction("get_barrier_free_detail", { name: "경복궁" }, ctx)).rejects.toThrow("HTTP 500");
  });

  it("이름을 못 풀면 placeNotFound이고 무장애 조회를 하지 않는다", async () => {
    const r = await executeFunction("get_barrier_free_detail", { name: "없는곳" }, ctx);
    expect(r.data).toEqual({ error: "'없는곳' 위치를 찾지 못했습니다." });
    expect(mockByName).not.toHaveBeenCalled();
  });

  it("장소 채팅: 인자가 없으면 앵커 장소로 찾는다(이름을 다시 검색하지 않는다)", async () => {
    const r = await executeFunction("get_barrier_free_detail", {}, anchorCtx);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockByName).toHaveBeenCalledWith(expect.objectContaining({ lat: DEOKSU.lat, lng: DEOKSU.lng, names: ["덕수궁"] }));
    expect(r.data).toMatchObject({ matched: true, searchedPlace: "덕수궁" });
  });

  it("장소 채팅: 앵커와 같은 이름을 넘겨도 앵커 좌표를 쓰고, 다른 이름이면 그 이름을 검색한다", async () => {
    await executeFunction("get_barrier_free_detail", { name: " 덕수궁 " }, anchorCtx);
    expect(mockSearch).not.toHaveBeenCalled();
    await executeFunction("get_barrier_free_detail", { name: "경복궁" }, anchorCtx);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockByName).toHaveBeenLastCalledWith(expect.objectContaining({ lat: GYEONGBOK.lat, lng: GYEONGBOK.lng }));
  });

  it("contentId가 있으면 종전 경로다(이름 인자는 보지 않는다)", async () => {
    mockDetail.mockResolvedValue(DETAIL);
    const r = await executeFunction("get_barrier_free_detail", { contentId: "126508", name: "경복궁" }, anchorCtx);
    expect(r.data).toEqual({ detail: DETAIL });
    expect(mockByName).not.toHaveBeenCalled();
  });

  it("한국 밖 장소는 커버리지 안내만 돌려준다", async () => {
    const r = await executeFunction("get_barrier_free_detail", { name: "후쿠오카" }, ctx);
    expect(r.data.outOfCoverage).toBe(true);
    // 말한 장소가 한국 밖이다 — 「현재 위치」가 한국 밖이라는 종전 문장을 쓰지 않는다(리뷰 SHOULD 1).
    expect(r.data.searchedPlace).toBe("후쿠오카");
    expect(String(r.data.notice)).not.toContain("현재 위치");
    expect(mockByName).not.toHaveBeenCalled();
  });
});
