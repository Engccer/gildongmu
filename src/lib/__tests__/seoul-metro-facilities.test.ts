import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/seoul-metro-facilities.json";

// env는 import 시점에 process.env로 동결되므로, fetchSeoulMetroFacilities의
// 키 유무 분기를 테스트하려면 env 모듈을 모킹해 키를 주입한다.
vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

// 엘리베이터 위치 폴백(OA-21212)은 기본적으로 실구현을 그대로 통과시키되
// (SEOUL_OPEN_DATA_KEY 없음 → 빈 배열, 네트워크 호출 없음), 실패 케이스만
// 개별 테스트에서 mockRejectedValueOnce로 오버라이드한다.
vi.mock("../providers/seoul-elevator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../providers/seoul-elevator")>();
  return { ...actual, fetchSeoulElevators: vi.fn(actual.fetchSeoulElevators) };
});

import {
  parseFacilityGroup,
  parseSeoulMetroFacilities,
} from "../providers/seoul-metro-facilities";
import { fetchSeoulElevators } from "../providers/seoul-elevator";
import { env } from "../env";

describe("parseFacilityGroup — 시설별 정규화", () => {
  // fixture(stnNm=강동 포함필터)는 강동+강동구청 혼재. 정확매칭 후 강동역만:
  // 엘리베이터 3(6중), 에스컬레이터 10(15중), 안전발판 1, 화장실 1, 충전기 0(강동구청만).
  it("엘리베이터: 위치·층·가동현황 보존, 강동만 정확매칭(강동구청 제외)", () => {
    const g = parseFacilityGroup("elevator", fixture.Elvtr, "강동");
    expect(g).not.toBeNull();
    expect(g!.kind).toBe("elevator");
    expect(g!.facilities.length).toBe(3); // 강동역 3대 (강동구청 3대 제외)
    const f = g!.facilities[0];
    expect(f.name).toBe("승강기)엘리베이터-강동 내부 1호기");
    expect(f.floors).toBe("지하B3~지하B4"); // bgng(지하B3) ~ end(지하B4)
    expect(f.operatingStatus).toBe("normal"); // oprtngSitu "M"
    expect(f.location).toBe("둔촌동 방면8-3"); // dtlPstn
  });

  it("에스컬레이터: dtlPstn 없이 bgngFlrDtlPstn 사용, S는 stopped", () => {
    const g = parseFacilityGroup("escalator", fixture.Esctr, "강동");
    expect(g!.facilities.length).toBe(10); // 강동역 10대 (강동구청 5대 제외)
    expect(
      g!.facilities.some((f) => f.operatingStatus === "stopped"),
    ).toBe(true); // 강동 10대 중 S 3건
  });

  it("장애인화장실: 종류를 detail로", () => {
    const g = parseFacilityGroup("restroom", fixture.Rstrm, "강동");
    expect(g!.facilities.length).toBe(1);
    expect(g!.facilities[0].detail).toContain("교통약자"); // rstrmInfo "일반(남,여) / 교통약자(남,여)"
  });

  it("빈 결과(강동 미설치 종류)는 null — 충전기는 강동구청만이라 강동역엔 없음", () => {
    expect(parseFacilityGroup("wheelchairLift", fixture.Whcllift, "강동")).toBeNull();
    expect(parseFacilityGroup("helper", fixture.Helper, "강동")).toBeNull();
    expect(parseFacilityGroup("wheelchairCharger", fixture.WhclCharge, "강동")).toBeNull();
  });

  it("정확매칭: 포함필터로 섞인 다른 역(강동구청)은 제외", () => {
    const g = parseFacilityGroup("elevator", fixture.Elvtr, "강동");
    // 강동역 3대 모두 stnNm "강동" — "강동구청"은 normalizeStationName이 달라 제외됨
    expect(g!.facilities.length).toBe(3);
    expect(g!.facilities.every((f) => f.name.includes("강동"))).toBe(true);
  });
});

describe("lineHint 동명이역 분리(Task 2: 카카오 진입 死 섹션 부활)", () => {
  // 실 wksn raw 형태를 흉내낸 합성 fixture — 같은 역명("테스트역")이 서로
  // 다른 노선에 존재하는 상황(양평 5호선/경의중앙선과 동형)을 재현한다.
  const dualLineRaw = {
    response: {
      body: {
        items: {
          item: [
            { stnNm: "테스트역", lineNm: "1호선", fcltNm: "1호선측 엘리베이터" },
            { stnNm: "테스트역", lineNm: "2호선", fcltNm: "2호선측 엘리베이터" },
          ],
        },
      },
    },
  };

  it("parseFacilityGroup: lineHint 없으면 동명이역 전부, 있으면 해당 노선만", () => {
    // normalizedTarget은 이미 정규화된 매칭 키("역" 접미 제거)를 받는다.
    const all = parseFacilityGroup("elevator", dualLineRaw, "테스트");
    expect(all!.facilities.length).toBe(2);
    const only1 = parseFacilityGroup("elevator", dualLineRaw, "테스트", "1호선");
    expect(only1!.facilities.length).toBe(1);
    expect(only1!.facilities[0].name).toBe("1호선측 엘리베이터");
  });

  it("parseSeoulMetroFacilities: 카카오 실명('테스트역 2호선')이 노선을 자동으로 좁힌다", () => {
    const raws = {
      elevator: dualLineRaw,
      escalator: { response: { body: { items: "" } } },
      wheelchairLift: { response: { body: { items: "" } } },
      movingWalk: { response: { body: { items: "" } } },
      wheelchairCharger: { response: { body: { items: "" } } },
      safetyPlatform: { response: { body: { items: "" } } },
      signLangPhone: { response: { body: { items: "" } } },
      helper: { response: { body: { items: "" } } },
      restroom: { response: { body: { items: "" } } },
    };
    const r = parseSeoulMetroFacilities(raws, "테스트역 2호선");
    expect(r).not.toBeNull();
    expect(r!.stationName).toBe("테스트"); // 노선 토큰·"역" 접미가 표시명에서도 빠진다
    expect(r!.line).toBe("2호선");
    expect(r!.groups[0].facilities).toHaveLength(1);
    expect(r!.groups[0].facilities[0].name).toBe("2호선측 엘리베이터");
  });
});

describe("parseSeoulMetroFacilities — 9종 묶음", () => {
  const raws = {
    elevator: fixture.Elvtr,
    escalator: fixture.Esctr,
    wheelchairLift: fixture.Whcllift,
    movingWalk: fixture.Mvnwlk,
    wheelchairCharger: fixture.WhclCharge,
    safetyPlatform: fixture.SafePlfm,
    signLangPhone: fixture.Slng,
    helper: fixture.Helper,
    restroom: fixture.Rstrm,
  };

  it("데이터 있는 종류만 groups에 — 강동은 4종(충전기는 강동구청만이라 제외)", () => {
    const r = parseSeoulMetroFacilities(raws, "강동");
    expect(r).not.toBeNull();
    expect(r!.stationName).toBe("강동");
    expect(r!.line).toBe("5호선");
    const kinds = r!.groups.map((g) => g.kind).sort();
    expect(kinds).toEqual(
      ["elevator", "escalator", "restroom", "safetyPlatform"].sort(),
    );
  });

  it("전 종류 빈 결과면 null(미커버 역 — graceful)", () => {
    const empty = { response: { body: { items: "" } } };
    const allEmpty = Object.fromEntries(
      Object.keys(raws).map((k) => [k, empty]),
    ) as unknown as typeof raws;
    expect(parseSeoulMetroFacilities(allEmpty, "없는역")).toBeNull();
  });
});

describe("fetchSeoulMetroFacilities — 9 병렬 + 장애 구분", () => {
  afterEach(() => vi.restoreAllMocks());

  function ok(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  it("카카오 실명('강동역 5호선')의 노선 토큰을 벗겨 서버에 보낸다(死 섹션 회귀 방지)", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const map: Record<string, unknown> = {
      getWksnElvtr: fixture.Elvtr,
      getWksnEsctr: fixture.Esctr,
      getWksnWhcllift: fixture.Whcllift,
      getWksnMvnwlk: fixture.Mvnwlk,
      getWksnWhclCharge: fixture.WhclCharge,
      getWksnSafePlfm: fixture.SafePlfm,
      getWksnSlng: fixture.Slng,
      getWksnHelper: fixture.Helper,
      getWksnRstrm: fixture.Rstrm,
    };
    const sentStnNm: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input));
      sentStnNm.push(url.searchParams.get("stnNm")!);
      const op = Object.keys(map).find((o) => url.pathname.endsWith(`/${o}`))!;
      return Promise.resolve(ok(map[op]));
    });
    const r = await fetchSeoulMetroFacilities("강동역 5호선");
    // 과거엔 "강동역 5호선" 원문 그대로 보내 stnNm 포함필터가 아무 것도
    // 못 잡아 섹션이 죽었다 — 이제 "강동"만 보낸다.
    expect(sentStnNm.every((v) => v === "강동")).toBe(true);
    expect(r).not.toBeNull();
    // wksn 4종(엘리베이터·에스컬레이터·안전발판·화장실) + Task 7 음성유도기 보강.
    expect(r!.groups.filter((g) => g.kind !== "voiceGuide").length).toBe(4);
    expect(r!.groups.some((g) => g.kind === "voiceGuide")).toBe(true);
  });

  it("9 오퍼레이션을 병렬 호출해 묶는다(강동 4종)", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const map: Record<string, unknown> = {
      getWksnElvtr: fixture.Elvtr,
      getWksnEsctr: fixture.Esctr,
      getWksnWhcllift: fixture.Whcllift,
      getWksnMvnwlk: fixture.Mvnwlk,
      getWksnWhclCharge: fixture.WhclCharge,
      getWksnSafePlfm: fixture.SafePlfm,
      getWksnSlng: fixture.Slng,
      getWksnHelper: fixture.Helper,
      getWksnRstrm: fixture.Rstrm,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const op = Object.keys(map).find((o) => url.includes(`/${o}?`))!;
      return Promise.resolve(ok(map[op]));
    });
    const r = await fetchSeoulMetroFacilities("강동역");
    expect(r).not.toBeNull();
    // 엘리베이터·에스컬레이터·안전발판·화장실 (충전기는 강동구청만) + Task 7 음성유도기 보강.
    expect(r!.groups.filter((g) => g.kind !== "voiceGuide").length).toBe(4);
    expect(r!.groups.some((g) => g.kind === "voiceGuide")).toBe(true);
  });

  it("주 fetch HTTP 실패는 throw(일시 장애 ≠ 정보 없음)", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    await expect(fetchSeoulMetroFacilities("강동역")).rejects.toThrow();
  });

  it("9개 중 1개만 실패해도 전체 throw — Promise.all any-fail→all-fail 불변식", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const map: Record<string, unknown> = {
      getWksnElvtr: fixture.Elvtr,
      getWksnEsctr: fixture.Esctr,
      getWksnWhcllift: fixture.Whcllift,
      getWksnMvnwlk: fixture.Mvnwlk,
      getWksnWhclCharge: fixture.WhclCharge,
      getWksnSafePlfm: fixture.SafePlfm,
      getWksnSlng: fixture.Slng,
      getWksnHelper: fixture.Helper,
      getWksnRstrm: fixture.Rstrm,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      // 엘리베이터 1종만 503, 나머지 8종은 정상 fixture.
      if (url.includes("/getWksnElvtr?")) {
        return Promise.resolve({ ok: false, status: 503 } as unknown as Response);
      }
      const op = Object.keys(map).find((o) => url.includes(`/${o}?`))!;
      return Promise.resolve(ok(map[op]));
    });
    await expect(fetchSeoulMetroFacilities("강동역")).rejects.toThrow();
  });

  it("totalCount가 numOfRows(300)를 넘으면 throw — 페이지 누락 은폐 금지", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    // totalCount 301 + item은 일부만 → 뒤 페이지가 잘린 상태. 조용히 넘기지 않는다.
    const truncated = {
      response: {
        body: {
          totalCount: 301,
          items: { item: [{ stnNm: "강동", fcltNm: "엘리베이터", lineNm: "5호선" }] },
        },
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(truncated));
    await expect(fetchSeoulMetroFacilities("강동역")).rejects.toThrow(/페이지 누락/);
  });
});

describe("fetchSeoulMetroFacilities — 시설 패널 병합(Task 7: 음성유도기+엘리베이터 위치 폴백)", () => {
  afterEach(() => vi.restoreAllMocks());

  function ok(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  const wksnMap: Record<string, unknown> = {
    getWksnElvtr: fixture.Elvtr,
    getWksnEsctr: fixture.Esctr,
    getWksnWhcllift: fixture.Whcllift,
    getWksnMvnwlk: fixture.Mvnwlk,
    getWksnWhclCharge: fixture.WhclCharge,
    getWksnSafePlfm: fixture.SafePlfm,
    getWksnSlng: fixture.Slng,
    getWksnHelper: fixture.Helper,
    getWksnRstrm: fixture.Rstrm,
  };

  function mockWksnFetch() {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const op = Object.keys(wksnMap).find((o) => url.includes(`/${o}?`))!;
      return Promise.resolve(ok(wksnMap[op]));
    });
  }

  it("강동(wksn elevator 그룹 존재) → elevatorLocation 그룹 없음, voiceGuide 그룹 존재(실 seed)", async () => {
    mockWksnFetch();
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const r = await fetchSeoulMetroFacilities("강동역 5호선");
    expect(r).not.toBeNull();
    const kinds = r!.groups.map((g) => g.kind);
    expect(kinds).toContain("elevator");
    expect(kinds).not.toContain("elevatorLocation");
    const voiceGroup = r!.groups.find((g) => g.kind === "voiceGuide");
    expect(voiceGroup).toBeDefined();
    expect(voiceGroup!.facilities.length).toBeGreaterThan(10);
    expect(r!.supplementFailed).toBeUndefined();
  });

  it("wksn 전부 빈 raws + voiceGuide 매칭 있음 → 비-null 반환, groups=[voiceGuide]", async () => {
    const empty = { response: { body: { items: "" } } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(empty));
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const r = await fetchSeoulMetroFacilities("강동역 5호선");
    expect(r).not.toBeNull();
    expect(r!.groups.map((g) => g.kind)).toEqual(["voiceGuide"]);
    expect(r!.supplementFailed).toBeUndefined();
  });

  it("엘리베이터 fetch reject 모킹 → supplementFailed: true, 기존 그룹 보존", async () => {
    // wksn: 에스컬레이터 1종만 있는 합성역("테스트역", voiceGuide 미커버)
    const escalatorOnlyRaw = {
      response: {
        body: {
          items: { item: [{ stnNm: "테스트역", lineNm: "1호선", fcltNm: "에스컬레이터" }] },
        },
      },
    };
    const empty = { response: { body: { items: "" } } };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/getWksnEsctr?")) return Promise.resolve(ok(escalatorOnlyRaw));
      return Promise.resolve(ok(empty));
    });
    vi.mocked(fetchSeoulElevators).mockRejectedValueOnce(new Error("tbTraficElvtr HTTP 503"));
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const r = await fetchSeoulMetroFacilities("테스트역");
    expect(r).not.toBeNull();
    expect(r!.groups.map((g) => g.kind)).toEqual(["escalator"]);
    expect(r!.supplementFailed).toBe(true);
  });

  it("SEOUL_OPEN_DATA_KEY 존재 + wksn elevator 없음 + OA-21212 성공 + seed 매칭 → elevatorLocation 병합", async () => {
    // wksn 9종 전부 빈 결과(elevator 그룹 없음) — 이 테스트만 SEOUL_OPEN_DATA_KEY를
    // 주입해 fetchSeoulElevators가 실제 fetch를 타도록 한다(다른 테스트는 키
    // 미주입 상태를 유지해야 하므로 finally에서 반드시 원복).
    env.SEOUL_OPEN_DATA_KEY = "test-open-key";
    try {
      const empty = { response: { body: { items: "" } } };
      // 강동역 seed 좌표(37.53581, 127.13249) 근처 2건(OA-21212 tbTraficElvtr shape).
      const elevatorFixture = {
        tbTraficElvtr: {
          RESULT: { CODE: "INFO-000" },
          row: [
            { SBWY_STN_NM: "강동역", NODE_WKT: "POINT(127.1335 37.5365)", EMD_NM: "천호동" },
            { SBWY_STN_NM: "강동역", NODE_WKT: "POINT(127.1315 37.5351)", EMD_NM: "천호동" },
          ],
        },
      };
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/json/tbTraficElvtr/")) return Promise.resolve(ok(elevatorFixture));
        return Promise.resolve(ok(empty)); // wksn 9종 전부 빈 결과
      });
      const { fetchSeoulMetroFacilities } = await import(
        "../providers/seoul-metro-facilities"
      );
      const r = await fetchSeoulMetroFacilities("강동역");
      expect(r).not.toBeNull();
      expect(r!.groups.map((g) => g.kind)).not.toContain("elevator");
      const group = r!.groups.find((g) => g.kind === "elevatorLocation");
      expect(group).toBeDefined();
      expect(group!.facilities.length).toBe(2);
      for (const f of group!.facilities) {
        expect(f.name).toMatch(/^역 중심 기준 (북|북동|동|남동|남|남서|서|북서)쪽 약 \d+m/);
      }
      expect(r!.supplementFailed).toBeUndefined();
    } finally {
      env.SEOUL_OPEN_DATA_KEY = undefined;
    }
  });
});
