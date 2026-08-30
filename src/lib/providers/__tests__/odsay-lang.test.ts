import { afterEach, describe, expect, it, vi } from "vitest";
import lang1 from "../../__tests__/fixtures/odsay-lang1.json";
import type { OdsayResponse } from "../odsay";

vi.mock("../../env", () => ({ env: { ODSAY_API_KEY: "test-key" } }));
vi.mock("../bus-service-hours", () => ({ fetchServiceHoursMap: vi.fn(async () => new Map()) }));
vi.mock("../subway-service-hours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../subway-service-hours")>()),
  fetchSubwayServiceHoursMap: vi.fn(async () => new Map()),
}));

import { assertKorComplete, getTransitRoute, normalizeOdsayRoutes } from "../odsay";

/**
 * E27 §3.1 — ODsay `lang=1` 응답 정규화. 길동→강남 실응답(2026-08-31) 절단본(path 3개: 지하철 3구간·
 * 9호선(급행) 포함·버스 포함, 경유 정류장 3개로 절단).
 */
const EN = lang1 as unknown as OdsayResponse;

/** 깊은 복사 후 한 경로에 변이 */
function mutated(mutate: (data: OdsayResponse) => void): OdsayResponse {
  const copy = JSON.parse(JSON.stringify(EN)) as OdsayResponse;
  mutate(copy);
  return copy;
}

describe("normalizeOdsayRoutes — lang=en(원칙 1: 한국어 필드 불변, 영문은 *En)", () => {
  const routes = normalizeOdsayRoutes(EN, { includeStops: true, lang: "en" })!;

  it("탑승 leg의 한국어 필드는 `*Kor`이고 영문은 `*En`에 실린다", () => {
    const [walk, subway] = routes[0].legs;
    expect(walk.mode).toBe("walk");
    expect(subway.lineName).toBe("수도권 5호선");
    expect(subway.lineNameEn).toBe("Line 5");
    expect(subway.fromName).toBe("길동");
    expect(subway.fromNameEn).toBe("Gildong");
    expect(subway.toName).toBe("천호");
    expect(subway.toNameEn).toBe("Cheonho (Pungnaptoseong)");
    expect(subway.stops![0].name).toBe("길동");
    expect(subway.stops![0].nameEn).toBe("Gildong");
    expect(routes[0].summary.departName).toBe("길동");
    expect(routes[0].summary.departNameEn).toBe("Gildong");
    expect(routes[0].summary.arriveNameEn).toBe("Gangnam");
  });

  it("도보 leg의 행선지(뒤 탑승 승차역)도 영문이 유도된다", () => {
    const walk = routes[0].legs[0];
    expect(walk.toName).toBe("길동");
    expect(walk.toNameEn).toBe("Gildong");
  });

  it("급행은 한국어 lineName에 `(급행)`이 남고 영문은 표가 `Line 9 Express`로 되살린다(ODsay 영문은 `Line 9`)", () => {
    const express = routes.flatMap((r) => r.legs).find((l) => l.lineName?.includes("(급행)"));
    expect(express).toBeDefined();
    expect(express!.lineName).toBe("수도권 9호선(급행)");
    expect(express!.lineNameEn).toBe("Line 9 Express");
  });

  it("버스 leg는 한국어 번호가 lineName, 영문 번호가 lineNameEn", () => {
    const bus = routes.flatMap((r) => r.legs).find((l) => l.mode === "bus");
    expect(bus).toBeDefined();
    expect(bus!.lineName).toBe("3413");
    expect(bus!.lineNameEn).toBe("3413");
    expect(bus!.serviceRouteId).toBeTruthy(); // 조인 키는 언어 무관
  });

  it("영문 자격 미달(한글 포함)은 필드 부재, 한국어는 그대로", () => {
    const data = mutated((d) => {
      d.result!.path![0].subPath[1].startName = "길동 Gildong";
    });
    const r = normalizeOdsayRoutes(data, { lang: "en" })!;
    expect(r[0].legs[1].fromName).toBe("길동");
    expect(r[0].legs[1].fromNameEn).toBeUndefined();
  });

  it("lang 미지정(ko)으로 같은 lang=1 응답을 넣으면 영문이 한국어 자리에 든다 — 그래서 라우트가 lang을 넘겨야 한다", () => {
    // 이 케이스는 계약 위반 경로가 아니라 "lang을 빠뜨리면 무엇이 보이나"의 문서화다.
    const r = normalizeOdsayRoutes(EN, {})!;
    expect(r[0].legs[1].fromName).toBe("Gildong");
    expect(r[0].legs[1].fromNameEn).toBeUndefined();
  });
});

describe("assertKorComplete — `*Kor` 완전성(설계 리뷰 #1·#12)", () => {
  it("실응답 절단본은 완전하다", () => {
    expect(assertKorComplete(EN)).toBeNull();
  });
  it("역명 Kor 결측을 경로로 돌려준다", () => {
    const data = mutated((d) => {
      delete d.result!.path![0].subPath[1].endNameKor;
    });
    expect(assertKorComplete(data)).toBe("path[0].subPath[1].endNameKor");
  });
  it("Kor에 한글이 없으면(영문이 들어옴) 결측으로 본다", () => {
    const data = mutated((d) => {
      d.result!.path![1].subPath[1].lane![0].nameKor = "Line 5";
    });
    expect(assertKorComplete(data)).toBe("path[1].subPath[1].lane[0].nameKor");
  });
  it("경유 정류장 Kor 결측·요약 Kor 결측도 잡는다", () => {
    const a = mutated((d) => {
      d.result!.path![0].subPath[1].passStopList!.stations![1].stationNameKor = "";
    });
    expect(assertKorComplete(a)).toMatch(/passStopList\.stations\[1\]\.stationNameKor$/);
    const b = mutated((d) => {
      delete d.result!.path![2].info.lastEndStationKor;
    });
    expect(assertKorComplete(b)).toBe("path[2].info.lastEndStationKor");
  });
  it("도보 subPath는 검사 대상이 아니다", () => {
    const data = mutated((d) => {
      d.result!.path![0].subPath[0].startName = "Somewhere";
    });
    expect(assertKorComplete(data)).toBeNull();
  });
});

describe("getTransitRoute — lang 배선·fail-closed(§3.1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(responder: (url: string) => unknown) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => responder(url), text: async () => "" };
      }),
    );
    return calls;
  }
  const ORIGIN = { lat: 37.5384, lng: 127.1408 };
  const DEST = { lat: 37.4979, lng: 127.0276 };

  it("lang=en은 `lang=1` URL로 부르고 영문 필드를 싣는다; ko는 파라미터가 없다", async () => {
    const calls = stubFetch((url) => (url.includes("lang=1") ? EN : { result: { path: [] } }));
    const en = await getTransitRoute({ origin: ORIGIN, dest: DEST, lang: "en" });
    expect(calls[0]).toContain("&lang=1&");
    expect(en!.recommended.legs[1].lineNameEn).toBe("Line 5");
    const ko = await getTransitRoute({ origin: ORIGIN, dest: DEST });
    expect(calls[1]).not.toContain("lang=");
    expect(ko).toBeNull(); // 빈 path = 경로 없음(테스트 스텁)
  });

  it("`*Kor`가 하나라도 빠진 lang=1 응답은 버리고 ko로 재조회한다(영문 없이 응답)", async () => {
    const broken = mutated((d) => {
      delete d.result!.path![0].subPath[1].startNameKor;
    });
    // ko 재조회 응답: lang=1 절단본에서 `*Kor`를 원래 필드로 옮긴 모양(= ko 모드 응답)
    const koData = mutated((d) => {
      for (const p of d.result!.path!) {
        p.info.firstStartStation = p.info.firstStartStationKor;
        p.info.lastEndStation = p.info.lastEndStationKor;
        for (const sp of p.subPath) {
          if (sp.trafficType === 3) continue;
          sp.startName = sp.startNameKor;
          sp.endName = sp.endNameKor;
          for (const l of sp.lane ?? []) {
            if (l.nameKor) l.name = l.nameKor;
            if (l.busNoKor) l.busNo = l.busNoKor;
          }
        }
      }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubFetch((url) => (url.includes("lang=1") ? broken : koData));
    const r = await getTransitRoute({ origin: ORIGIN, dest: DEST, lang: "en" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("lang=1");
    expect(calls[1]).not.toContain("lang=");
    const leg = r!.recommended.legs[1];
    expect(leg.fromName).toBe("길동");
    expect(leg.fromNameEn).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/En"/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("path[0].subPath[1].startNameKor"));
    warn.mockRestore();
  });
});
