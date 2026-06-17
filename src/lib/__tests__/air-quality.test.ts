import { describe, it, expect, vi, afterEach } from "vitest";
import nearbyFixture from "./fixtures/air-nearby-stations.json";
import measureFixture from "./fixtures/air-measure.json";

// env는 import 시점 동결 — 키 있음으로 모킹.
vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
  hasDataGoKrKey: () => true,
}));

import {
  wgs84ToTm,
  parseNearestStation,
  parsePollutant,
  parseAirMeasure,
  gradeFromCode,
  findAirQualityNear,
} from "../providers/air-quality";
import { env } from "../env";

describe("wgs84ToTm (EPSG:2097 변환 — deterministic 잠금)", () => {
  // getTMStdrCrdnt 정본: 역삼동 (203338.99, 444208.20). 손어림 좌표라 ±150m 허용.
  it("역삼동 WGS84 → TM중부원점(정본 대비 ±150m)", () => {
    const { tmX, tmY } = wgs84ToTm(37.5006, 127.0364);
    expect(Math.abs(tmX - 203338.99)).toBeLessThan(150);
    expect(Math.abs(tmY - 444208.2)).toBeLessThan(150);
  });

  it("동일 입력 → 동일 출력(순수·결정적)", () => {
    expect(wgs84ToTm(37.5, 127.0)).toEqual(wgs84ToTm(37.5, 127.0));
  });

  it("부산은 서울보다 동쪽(tmX 큼)·남쪽(tmY 작음)", () => {
    const seoul = wgs84ToTm(37.5665, 126.978);
    const busan = wgs84ToTm(35.1796, 129.0756);
    expect(busan.tmX).toBeGreaterThan(seoul.tmX);
    expect(busan.tmY).toBeLessThan(seoul.tmY);
  });
});

describe("parseNearestStation (근접 측정소 — API 거리순 첫 항목)", () => {
  it("첫 항목(최근접)을 stationName·distanceKm·addr로 투영", () => {
    const s = parseNearestStation(nearbyFixture);
    expect(s).not.toBeNull();
    expect(s!.stationName).toBe("천호대로");
    expect(s!.distanceKm).toBe(0.5);
    expect(s!.addr).toContain("강동구");
  });

  it("빈 결과(items:\"\") → null", () => {
    expect(parseNearestStation({ response: { body: { items: "" } } })).toBeNull();
  });

  it("items.item 단일 객체(1건)도 처리", () => {
    const raw = {
      response: { body: { items: { item: { stationName: "단건", tm: 1.2, addr: "주소" } } } },
    };
    expect(parseNearestStation(raw)!.stationName).toBe("단건");
  });
});

describe("gradeFromCode (1~4 → 등급, 그 외 unknown)", () => {
  it("1좋음·2보통·3나쁨·4매우나쁨", () => {
    expect(gradeFromCode("1")).toBe("good");
    expect(gradeFromCode("2")).toBe("moderate");
    expect(gradeFromCode("3")).toBe("bad");
    expect(gradeFromCode("4")).toBe("veryBad");
  });
  it("부재·비정상 코드 → unknown", () => {
    expect(gradeFromCode(null)).toBe("unknown");
    expect(gradeFromCode("")).toBe("unknown");
    expect(gradeFromCode("-")).toBe("unknown");
    expect(gradeFromCode("9")).toBe("unknown");
  });
});

describe("parsePollutant (3-state: Flag→unknown)", () => {
  it("정상 값+등급", () => {
    expect(parsePollutant("57", "2", null)).toEqual({ value: 57, grade: "moderate" });
  });
  it("측정 장애(Flag non-null) → value:null·grade:unknown (숫자 노출 금지)", () => {
    const p = parsePollutant("57", "2", "통신장애");
    expect(p.value).toBeNull();
    expect(p.grade).toBe("unknown");
  });
  it("값 '-'/부재 → null, 등급 부재 → unknown", () => {
    expect(parsePollutant("-", "2", null).value).toBeNull();
    expect(parsePollutant(null, null, null)).toEqual({ value: null, grade: "unknown" });
  });
  it("값은 있고 등급만 부재 → value 보존, grade unknown", () => {
    expect(parsePollutant("57", null, null)).toEqual({ value: 57, grade: "unknown" });
  });
});

describe("parseAirMeasure (측정소 실시간 → AirQuality)", () => {
  const station = { stationName: "천호대로", distanceKm: 0.5, addr: "서울 강동구..." };

  it("실응답 fixture를 AirQuality로 투영", () => {
    const aq = parseAirMeasure(measureFixture, station);
    expect(aq).not.toBeNull();
    expect(aq!.stationName).toBe("천호대로");
    expect(aq!.distanceKm).toBe(0.5);
    expect(aq!.dataTime).toBe("2026-06-17 19:00");
    expect(aq!.khai).toEqual({ value: 229, grade: "bad" }); // khaiGrade 3
    expect(aq!.pm10).toEqual({ value: 57, grade: "moderate" });
    expect(aq!.pm25).toEqual({ value: 46, grade: "moderate" });
  });

  it("빈 측정(items:\"\") → null (graceful 숨김)", () => {
    expect(parseAirMeasure({ response: { body: { items: "" } } }, station)).toBeNull();
  });

  // khai는 에어코리아 공식 통합지수(우리 파생값 아님)라 pm10/pm25 Flag와 독립 —
  // pm10 측정 장애여도 khai는 보존(설계 의도, parseAirMeasure가 Flag 항상 null 주입).
  it("pm10Flag 장애 → pm10 unknown, pm25·khai는 보존(khai는 Flag 독립 — 설계 의도)", () => {
    const raw = {
      response: {
        body: {
          items: {
            item: {
              khaiValue: "80", khaiGrade: "2",
              pm10Value: "30", pm10Grade: "1", pm10Flag: "점검및교정",
              pm25Value: "20", pm25Grade: "2", pm25Flag: null,
              dataTime: "2026-06-17 19:00",
            },
          },
        },
      },
    };
    const aq = parseAirMeasure(raw, station)!;
    expect(aq.pm10).toEqual({ value: null, grade: "unknown" });
    expect(aq.pm25).toEqual({ value: 20, grade: "moderate" });
    expect(aq.khai).toEqual({ value: 80, grade: "moderate" }); // Flag 무관 — 보존
  });
});

describe("findAirQualityNear (2-call 합성·키 게이트)", () => {
  afterEach(() => vi.restoreAllMocks());
  // provider는 res.text() 후 JSON.parse(인증 XML 에러 방어) — text를 제공한다.
  const ok = (json: unknown): Response =>
    ({ ok: true, status: 200, text: async () => JSON.stringify(json) } as unknown as Response);

  it("키 없음 → null, fetch 미호출", async () => {
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "";
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await findAirQualityNear(37.5, 127.0)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "test-key";
  });

  it("정상 2-call → AirQuality", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(ok(nearbyFixture)); // call 1: 근접 측정소
    spy.mockResolvedValueOnce(ok(measureFixture)); // call 2: 측정소 실시간
    const aq = await findAirQualityNear(37.538, 127.139);
    expect(aq!.stationName).toBe("천호대로");
    expect(aq!.khai.grade).toBe("bad");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("근접 측정소 없음 → null (2번째 호출 안 함)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    // 실제 빈 응답도 resultCode "00"(정상) + 빈 items.
    spy.mockResolvedValueOnce(
      ok({ response: { header: { resultCode: "00" }, body: { items: "" } } }),
    );
    expect(await findAirQualityNear(37.5, 127.0)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("upstream 장애(HTTP 실패) → throw (502 — 정보 없음과 구분)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(findAirQualityNear(37.5, 127.0)).rejects.toThrow();
  });

  it("인증 실패 XML이 HTTP 200으로 와도 throw (res.json SyntaxError 대신 명확한 에러)", async () => {
    // data.go.kr은 키 만료·미등록 시 returnType=json이어도 XML을 200으로 보낸다.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',
    } as unknown as Response);
    await expect(findAirQualityNear(37.5, 127.0)).rejects.toThrow();
  });
});
