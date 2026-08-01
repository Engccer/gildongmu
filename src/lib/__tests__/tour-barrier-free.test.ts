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

describe("normalizeName — 보수적 동일성", () => {
  it("괄호·공백·지점 접미 제거", () => {
    expect(normalizeName("국립중앙박물관 (용산)")).toBe("국립중앙박물관");
    expect(normalizeName("스타벅스 강남본점")).toBe("스타벅스 강남".replace(/\s+/g, ""));
  });
  it("다른 이름은 다른 정규화", () => {
    expect(normalizeName("경복궁")).not.toBe(normalizeName("덕수궁"));
  });
});
