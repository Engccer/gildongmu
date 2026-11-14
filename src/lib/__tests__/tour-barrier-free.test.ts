import { describe, it, expect, vi, afterEach } from "vitest";

// env는 import 시점 동결 — data.go.kr 키 있음으로 모킹(night-clinic 동형).
vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
  hasDataGoKrKey: () => true,
}));

import {
  labelFacilities,
  cleanFacilityValue,
  BARRIER_FREE_FIELD_LABELS,
  normalizeName,
  searchBarrierFreeNearby,
  findBarrierFreeByName,
  NAME_MATCH_RADIUS_METERS,
} from "../providers/tour-barrier-free";

// envelope 모양 계약은 providers/__tests__/datagokr-envelope.test.ts로 이관.
// 이 파일은 무장애 도메인(라벨링·매칭·거리)만 다룬다.

describe("labelFacilities — 실응답 기반 3-state + 값 정제", () => {
  // 서울도서관(130183) detailWithTour2 실응답 발췌(2026-06-30 실호출)
  const seoulLib = {
    contentid: "130183",
    parking: "장애인 전용 주차구역 있음(시청 공동)_무장애 편의시설<br/>\n평일-유료,주말-무료이용",
    route: "",
    wheelchair: "무료대여(2대,1층 장애인자료실)",
    exit: "주출입구는 단차가 없어 평지로 연결됨(후문)",
    elevator: "엘리베이터 있음",
    restroom: "장애인 전용 화장실 있음(각 층)",
    handicapetc: "발달장애인 도서,책장 넘기는 도구 있음",
    braileblock: "",
    blindhandicapetc:
      "시각장애인을 위한 컨텐츠 있음_시각장애인 편의시설<br/>\n점자도서,점자라벨도서,촉각도서",
    hearinghandicapetc: "청각장애인을 위한 컨텐츠 있음_청각장애인 편의시설",
  };

  it("값 있는 화이트리스트 키만 라벨링, 빈 값·미상 키 제외", () => {
    const keys = labelFacilities(seoulLib).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "parking", "wheelchair", "exit", "elevator", "restroom",
        "handicapetc", "blindhandicapetc", "hearinghandicapetc",
      ]),
    );
    expect(keys).not.toContain("route"); // 빈 값
    expect(keys).not.toContain("braileblock"); // 빈 값
    expect(keys).not.toContain("contentid"); // 화이트리스트 밖
    expect(labelFacilities(seoulLib).find((f) => f.key === "wheelchair")?.label).toBe(
      BARRIER_FREE_FIELD_LABELS["wheelchair"],
    );
  });

  it("값 정제 — <br/>·분류 접미 제거(SR 낭독 정합)", () => {
    const parking = labelFacilities(seoulLib).find((f) => f.key === "parking")!;
    expect(parking.value).not.toMatch(/<br/i);
    expect(parking.value).not.toContain("_무장애 편의시설");
    expect(parking.value).toContain("장애인 전용 주차구역");
    const blind = labelFacilities(seoulLib).find((f) => f.key === "blindhandicapetc")!;
    expect(blind.value).not.toContain("_시각장애인 편의시설");
    expect(blind.value).toContain("점자도서");
  });

  it("brailepromotion(실키)이 화이트리스트에 있고 추정 braileguide는 제거됨", () => {
    expect(BARRIER_FREE_FIELD_LABELS).toHaveProperty("brailepromotion");
    expect(BARRIER_FREE_FIELD_LABELS).not.toHaveProperty("braileguide");
  });

  it("모든 필드가 비면 빈 배열", () => {
    expect(labelFacilities({ wheelchair: "", restroom: "   " })).toEqual([]);
  });
});

describe("cleanFacilityValue — HTML·분류 접미 정제", () => {
  it("<br/> 태그 → 공백", () => {
    expect(cleanFacilityValue("a<br/>b<br>c")).toBe("a b c");
  });
  it("분류 접미(_무장애/시각장애인 편의시설 등) 제거", () => {
    expect(cleanFacilityValue("장애인 주차장 있음_무장애 편의시설")).toBe("장애인 주차장 있음");
    expect(cleanFacilityValue("컨텐츠 있음_시각장애인 편의시설")).toBe("컨텐츠 있음");
  });
  it("과잉 공백·개행 정리", () => {
    expect(cleanFacilityValue("a\n\n  b  ")).toBe("a b");
  });
  it("nullish → 빈 문자열", () => {
    expect(cleanFacilityValue(null)).toBe("");
    expect(cleanFacilityValue(undefined)).toBe("");
  });
});

describe("searchBarrierFreeNearby (서버 캡 — numOfRows 위임)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("서버 캡 50 — numOfRows=50 요청(표시 절단은 클라이언트 몫, V1 동형)", async () => {
    const empty = { response: { header: { resultCode: "0000" }, body: { items: "" } } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(empty),
    } as unknown as Response);
    await searchBarrierFreeNearby(37.5, 127.1);
    const calledUrl = spy.mock.calls[0][0] as URL;
    expect(calledUrl.searchParams.get("numOfRows")).toBe("50");
  });
});

describe("findBarrierFreeByName — 이름으로 찾기(E88)", () => {
  afterEach(() => vi.restoreAllMocks());

  // 카카오가 준 경복궁 좌표. 관광공사 등록 좌표(GYEONGBOK_TOUR)와 약 400m 어긋난다(실호출 2026-11-14).
  const KAKAO = { lat: 37.5796, lng: 126.977 };
  const item = (contentid: string, title: string, lat: number, lng: number) => ({ contentid, title, mapy: String(lat), mapx: String(lng), addr1: "주소" });
  const GYEONGBOK_TOUR = item("126508", "경복궁", 37.5760307, 126.9767218661);
  const envelope = (items: unknown[]) => ({
    response: { header: { resultCode: "0000" }, body: { items: items.length > 0 ? { item: items } : "" } },
  });

  /** 오퍼레이션별 응답을 정해 둔 upstream. 부른 오퍼레이션을 순서대로 적는다. */
  function upstream(byOp: Record<string, unknown[]>) {
    const ops: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input as URL;
      const op = url.pathname.split("/").at(-1)!;
      ops.push(op);
      return { ok: true, status: 200, text: async () => JSON.stringify(envelope(byOp[op] ?? [])) } as unknown as Response;
    });
    return ops;
  }

  it("좌표 목록이 비어도 이름 검색으로 찾는다(좌표가 400m 어긋난 넓은 부지) — 상세에 등록 이름을 싣는다", async () => {
    const ops = upstream({
      locationBasedList2: [],
      searchKeyword2: [GYEONGBOK_TOUR, item("2629723", "경복궁식당", 36.1148, 128.0164)],
      detailWithTour2: [{ contentid: "126508", wheelchair: "대여가능" }],
    });
    const r = await findBarrierFreeByName({ ...KAKAO, names: ["경복궁"] });
    expect(r.detail).toMatchObject({ contentId: "126508", name: "경복궁", facilities: [{ key: "wheelchair", label: "휠체어 대여", value: "대여가능" }] });
    expect(r.similar).toEqual([]);
    expect(ops).toEqual(["locationBasedList2", "searchKeyword2", "detailWithTour2"]);
  });

  it("장소 상세 화면과 같은 판정(50m ∩ 이름)이 맞으면 이름 검색을 하지 않는다", async () => {
    const ops = upstream({
      locationBasedList2: [item("1", "경복궁", KAKAO.lat, KAKAO.lng)],
      detailWithTour2: [{ contentid: "1", elevator: "있음" }],
    });
    const r = await findBarrierFreeByName({ ...KAKAO, names: ["경복궁"] });
    expect(r.detail?.contentId).toBe("1");
    // 상세 응답에는 이름이 없다 — 찾은 이름으로 채운다.
    expect(r.detail?.name).toBe("경복궁");
    expect(ops).not.toContain("searchKeyword2");
  });

  it("이름이 같아도 거리 가드 밖이면 다른 곳이다(다른 도시의 같은 이름)", async () => {
    upstream({ locationBasedList2: [], searchKeyword2: [item("9", "경복궁", 35.1, 129.0)] });
    expect(NAME_MATCH_RADIUS_METERS).toBe(1000);
    expect(await findBarrierFreeByName({ ...KAKAO, names: ["경복궁"] })).toEqual({ detail: null, similar: [] });
  });

  it("못 찾음: 이름이 꼭 같지 않은 근처 등록 장소는 similar로만 알린다(상세를 대신 주지 않는다)", async () => {
    const ops = upstream({
      locationBasedList2: [],
      searchKeyword2: [
        item("1605981", "덕수궁 대한문", KAKAO.lat + 0.001, KAKAO.lng),
        item("130173", "국립현대미술관 덕수궁", KAKAO.lat + 0.002, KAKAO.lng),
      ],
    });
    const r = await findBarrierFreeByName({ ...KAKAO, names: ["덕수궁 석조전"] });
    expect(r.detail).toBeNull();
    expect(r.similar.map((x) => x.name)).toEqual(["덕수궁 대한문", "국립현대미술관 덕수궁"]);
    expect(r.similar[0]).toEqual({ name: "덕수궁 대한문", distanceMeters: expect.any(Number) });
    expect(ops).not.toContain("detailWithTour2");
  });

  it("부르는 이름이 둘이면 첫 이름으로 검색하고 어느 이름과든 같으면 맞은 것이다", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input as URL;
      const op = url.pathname.split("/").at(-1)!;
      if (op === "searchKeyword2") calls.push(url.searchParams.get("keyword") ?? "");
      const items =
        op === "searchKeyword2" ? [item("5", "서울시립미술관 서소문본관", KAKAO.lat, KAKAO.lng + 0.002)]
        : op === "detailWithTour2" ? [{ contentid: "5", restroom: "있음" }]
        : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(envelope(items)) } as unknown as Response;
    });
    const r = await findBarrierFreeByName({ ...KAKAO, names: ["서울시립미술관", "서울시립미술관 서소문본관"] });
    expect(calls).toEqual(["서울시립미술관"]);
    expect(r.detail).toMatchObject({ contentId: "5", name: "서울시립미술관 서소문본관" });
  });

  it("이름이 맞은 등록 장소의 상세가 비면 못 찾음과 같은 모양이다(detail:null)", async () => {
    upstream({ locationBasedList2: [], searchKeyword2: [GYEONGBOK_TOUR], detailWithTour2: [] });
    expect(await findBarrierFreeByName({ ...KAKAO, names: ["경복궁"] })).toEqual({ detail: null, similar: [] });
  });

  it("조회 실패는 던진다(못 찾음과 다른 상태)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500, text: async () => "" } as unknown as Response);
    await expect(findBarrierFreeByName({ ...KAKAO, names: ["경복궁"] })).rejects.toThrow();
  });

  it("이름이 없으면 upstream을 부르지 않는다", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await findBarrierFreeByName({ ...KAKAO, names: ["  "] })).toEqual({ detail: null, similar: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("normalizeName — 보수적 동일성", () => {
  it("괄호·공백·지점 접미 제거", () => {
    expect(normalizeName("국립중앙박물관 (용산)")).toBe("국립중앙박물관");
    expect(normalizeName("스타벅스 강남본점")).toBe("스타벅스 강남".replace(/\s+/g, ""));
  });
  it("다른 이름은 다른 정규화", () => {
    expect(normalizeName("경복궁")).not.toBe(normalizeName("덕수궁"));
  });
});
