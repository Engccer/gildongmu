import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/korail-facilities.json";

// env는 import 시점에 process.env로 동결되므로, fetchStationFacilities의
// 키 유무 분기를 테스트하려면 env 모듈을 모킹해 키를 주입한다.
vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
}));

import {
  parseStationItems,
  parseStationFacilities,
  fetchStationFacilities,
} from "../providers/korail-facilities";

/**
 * 한국철도공사 편의시설 파서 테스트 — fixture는 2026-06-14 실응답.
 *
 * 실 API는 역명 필터를 지원하지 않아 전체(406역) 리스트를 받아
 * 정규화된 역명으로 클라이언트 매칭한다. 교통약자 정보가 두 엔드포인트
 * (weekPersonFacilities·stationFacilities)에 분산되므로 둘을 조인한다.
 */

const wpf = fixture.weekPersonFacilities;
const sf = fixture.stationFacilities;

describe("parseStationItems", () => {
  it("envelope에서 item 배열을 뽑는다", () => {
    const items = parseStationItems(wpf);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(3);
  });
  it("빈 결과(items 없음)는 빈 배열", () => {
    expect(parseStationItems({ response: { body: { items: "" } } })).toEqual([]);
    expect(parseStationItems(null)).toEqual([]);
    expect(parseStationItems({})).toEqual([]);
  });
  it("item이 단일 객체로 와도 배열로 정규화", () => {
    const single = {
      response: { body: { items: { item: { stn_nm: "서울", stn_cd: "1" } } } },
    };
    expect(parseStationItems(single).length).toBe(1);
  });
});

describe("parseStationFacilities", () => {
  it("서울역 — 두 엔드포인트 조인 후 정규화", () => {
    const result = parseStationFacilities(wpf, sf, "서울");
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe("서울");
    expect(result!.accessibleToilet).toBe(true); // pwdbs_tolt_estnc=Y
    expect(result!.wheelchairLifts).toBe(1); // whlch_liftt_cnt=1
    expect(result!.accessibleSlope).toBe(true); // pwdbs_slwy_estnc=Y
    expect(result!.elevators).toBe(18); // stationFacilities elevt_cnt=18
  });

  it("행신역 — 리프트 0·엘리베이터 4 (숫자 0은 0으로 보존, undefined 아님)", () => {
    const result = parseStationFacilities(wpf, sf, "행신");
    expect(result!.wheelchairLifts).toBe(0); // "0대"는 정보 없음과 다르다
    expect(result!.elevators).toBe(4);
    expect(result!.accessibleToilet).toBe(true);
  });

  it("가야역 — 장애인 화장실 없음, 엘리베이터/리프트 0 보존", () => {
    const result = parseStationFacilities(wpf, sf, "가야");
    expect(result!.accessibleToilet).toBe(false);
    expect(result!.accessibleSlope).toBe(false);
    expect(result!.wheelchairLifts).toBe(0); // 숫자 0 → 0
    expect(result!.elevators).toBe(0); // 숫자 0 → 0 ("정보 없음"이 아님)
  });

  it('빈 수치 필드는 undefined("정보 없음")로 파싱 — "0대"와 뭉개지 않음', () => {
    // 휠체어 리프트가 빈문자열인 weekPerson, 엘리베이터가 빈문자열인 station.
    const wpfBlank = {
      response: {
        body: {
          items: {
            item: [
              {
                pwdbs_slwy_estnc: "Y",
                pwdbs_tolt_estnc: "Y",
                stn_cd: "9000001",
                stn_nm: "테스트",
                whlch_liftt_cnt: "",
              },
            ],
          },
        },
      },
    };
    const sfBlank = {
      response: {
        body: {
          items: {
            item: [{ stn_cd: "9000001", stn_nm: "테스트", elevt_cnt: "" }],
          },
        },
      },
    };
    const result = parseStationFacilities(wpfBlank, sfBlank, "테스트");
    expect(result!.wheelchairLifts).toBeUndefined();
    expect(result!.elevators).toBeUndefined();
  });

  it("stn_cd로 보조 데이터를 조인 — 역명이 같아도 코드 불일치면 엘리베이터 미조인", () => {
    // weekPerson은 stn_cd=3900023(서울), station은 같은 역명 "서울"이지만
    // 다른 stn_cd(9999999) → 동명이역 혼입 방지로 엘리베이터는 undefined.
    const sfWrongCode = {
      response: {
        body: {
          items: {
            item: [{ stn_cd: "9999999", stn_nm: "서울", elevt_cnt: 99 }],
          },
        },
      },
    };
    const result = parseStationFacilities(wpf, sfWrongCode, "서울");
    expect(result).not.toBeNull();
    expect(result!.accessibleToilet).toBe(true); // weekPerson(서울)은 정상
    expect(result!.elevators).toBeUndefined(); // 코드 불일치 → 미조인
  });

  it("매칭 역 없으면 null(미커버 역 — graceful)", () => {
    expect(parseStationFacilities(wpf, sf, "강남")).toBeNull();
  });

  it("stationFacilities가 비어도 weekPerson만으로 부분 결과", () => {
    const emptySf = { response: { body: { items: "" } } };
    const result = parseStationFacilities(wpf, emptySf, "서울");
    expect(result).not.toBeNull();
    expect(result!.accessibleToilet).toBe(true);
    expect(result!.elevators).toBeUndefined();
  });

  it("교통약자(weekPerson)가 비면 null — 핵심 데이터 부재", () => {
    const emptyWpf = { response: { body: { items: "" } } };
    expect(parseStationFacilities(emptyWpf, sf, "서울")).toBeNull();
  });
});

describe("fetchStationFacilities — 일시 장애 vs 정보 없음 구분", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** weekPersonFacilities / stationFacilities 응답을 분기해 주는 fetch 스텁. */
  function stubFetch(handler: (path: string) => Promise<Response>) {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const path = url.includes("weekPersonFacilities")
        ? "weekPersonFacilities"
        : "stationFacilities";
      return handler(path);
    });
  }

  function ok(json: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => json,
    } as unknown as Response;
  }

  it("주(weekPerson) HTTP 실패는 throw — 일시 장애를 '정보 없음'으로 뭉개지 않음", async () => {
    stubFetch(async (path) => {
      if (path === "weekPersonFacilities") {
        return { ok: false, status: 503 } as unknown as Response;
      }
      return ok(sf);
    });
    await expect(fetchStationFacilities("서울역")).rejects.toThrow();
  });

  it("주는 정상이고 보조(stationFacilities)만 실패하면 부분 결과(엘리베이터 undefined)", async () => {
    stubFetch(async (path) => {
      if (path === "weekPersonFacilities") return ok(wpf);
      throw new Error("보조 일시 장애");
    });
    const result = await fetchStationFacilities("서울역");
    expect(result).not.toBeNull();
    expect(result!.accessibleToilet).toBe(true);
    expect(result!.elevators).toBeUndefined(); // 보조 실패 → 흡수
  });

  it("미커버 역(주 응답 빈 결과)은 null — 정보 없음(graceful)", async () => {
    const emptyWpf = { response: { body: { items: "" } } };
    stubFetch(async (path) =>
      ok(path === "weekPersonFacilities" ? emptyWpf : sf),
    );
    expect(await fetchStationFacilities("없는역")).toBeNull();
  });
});
