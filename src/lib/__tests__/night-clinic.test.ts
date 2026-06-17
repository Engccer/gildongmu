import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/baby-clinics.json";

// env는 import 시점 동결 — 키 있음으로 모킹.
vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
  hasDataGoKrKey: () => true,
}));

import {
  parseClinics,
  rankClinicsByDistance,
  clinicOpenStatus,
  dayToHoursIndex,
  extractItems,
  fetchNightClinics,
  findNightClinicsNear,
} from "../providers/night-clinic";
import type { ClinicHours } from "../types";
import { env } from "../env";

const H = (start: number | null, end: number | null): ClinicHours => ({ start, end });
/** 8칸 진료시간 — 전 요일 동일 [s,e]. */
const allDays = (s: number | null, e: number | null): ClinicHours[] =>
  Array.from({ length: 8 }, () => H(s, e));

describe("parseClinics (달빛어린이병원 목록 정규화)", () => {
  it("실응답 fixture를 NightClinic[]으로 투영한다", () => {
    const clinics = parseClinics(fixture);
    expect(clinics.length).toBe(4);
    const c = clinics[0];
    expect(c.name).toBeTruthy();
    expect(Number.isFinite(c.lat)).toBe(true);
    expect(Number.isFinite(c.lng)).toBe(true);
    expect(c.hours).toHaveLength(8);
    expect(c.distanceMeters).toBe(Number.POSITIVE_INFINITY); // 거리 미부여
  });

  it("좌표 비유한 항목은 제외한다", () => {
    const raw = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [
              { hpid: "A", dutyName: "좌표있음", wgs84Lat: "37.5", wgs84Lon: "127.0" },
              { hpid: "B", dutyName: "좌표없음", wgs84Lat: "", wgs84Lon: "" },
            ],
          },
          totalCount: 2,
        },
      },
    };
    const clinics = parseClinics(raw);
    expect(clinics.map((c) => c.name)).toEqual(["좌표있음"]);
  });

  it("items.item 단일 객체(1건)도 배열로 처리한다", () => {
    const raw = {
      response: {
        body: { items: { item: { hpid: "X", dutyName: "단건", wgs84Lat: "37.5", wgs84Lon: "127.0" } } },
      },
    };
    expect(parseClinics(raw)).toHaveLength(1);
  });

  it("빈 결과(items:\"\")는 빈 배열", () => {
    expect(extractItems({ response: { body: { items: "" } } })).toEqual([]);
    expect(parseClinics({ response: { body: { items: "" } } })).toEqual([]);
  });
});

describe("rankClinicsByDistance (Haversine 정렬·반경·상위N)", () => {
  const base = {
    id: "x", name: "n", address: "a", phone: "", kind: "", emergencyClass: "",
    directions: "", distanceMeters: Infinity, hours: allDays(null, null),
  };
  // 강남(37.4979,127.0276) 기준 가까운/먼 좌표
  const clinics = [
    { ...base, name: "먼곳(부산)", lat: 35.1, lng: 129.0 },
    { ...base, name: "가까운곳", lat: 37.498, lng: 127.028 },
    { ...base, name: "중간(서울외곽)", lat: 37.6, lng: 127.1 },
  ];

  it("거리 오름차순 정렬 + 거리 부여", () => {
    const r = rankClinicsByDistance(clinics, 37.4979, 127.0276, { radiusMeters: 1e9, limit: 10 });
    expect(r[0].name).toBe("가까운곳");
    expect(r[0].distanceMeters).toBeLessThan(r[1].distanceMeters);
  });

  it("반경 cap으로 먼 곳 제외(부산 사용자에게 서울 표시 방지의 역)", () => {
    const r = rankClinicsByDistance(clinics, 37.4979, 127.0276, { radiusMeters: 20_000 });
    expect(r.find((c) => c.name === "먼곳(부산)")).toBeUndefined();
    expect(r.find((c) => c.name === "가까운곳")).toBeTruthy();
  });

  it("limit으로 상위 N만", () => {
    const r = rankClinicsByDistance(clinics, 37.4979, 127.0276, { radiusMeters: 1e9, limit: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("가까운곳");
  });
});

describe("clinicOpenStatus (3-state: open/closed/unknown)", () => {
  it("진료 시간 내 → open", () => {
    expect(clinicOpenStatus(allDays(1800, 2400), 0, 2030).state).toBe("open");
  });
  it("진료 시간 밖 → closed", () => {
    expect(clinicOpenStatus(allDays(1800, 2400), 0, 1700).state).toBe("closed");
  });
  it("해당 요일 정보 없음(null) → unknown (마감 아님)", () => {
    expect(clinicOpenStatus(allDays(null, null), 0, 2030).state).toBe("unknown");
  });
  it("종료 2400 = 자정, 23:59까지 open", () => {
    expect(clinicOpenStatus(allDays(900, 2400), 0, 2359).state).toBe("open");
  });
  it("시작 경계 포함, 종료 경계 제외", () => {
    expect(clinicOpenStatus(allDays(1800, 2300), 0, 1800).state).toBe("open");
    expect(clinicOpenStatus(allDays(1800, 2300), 0, 2300).state).toBe("closed");
  });
  it("교차자정(start>end) 방어: 0100은 open", () => {
    expect(clinicOpenStatus(allDays(1800, 200), 0, 100).state).toBe("open");
    expect(clinicOpenStatus(allDays(1800, 200), 0, 1500).state).toBe("closed");
  });
  it("start==end → closed (0분 운영)", () => {
    expect(clinicOpenStatus(allDays(900, 900), 0, 900).state).toBe("closed");
    expect(clinicOpenStatus(allDays(900, 900), 0, 1000).state).toBe("closed");
  });
  it("0000~0000(운영 없음 관례) → unknown (마감 아님), start/end null", () => {
    const s = clinicOpenStatus(allDays(0, 0), 0, 900);
    expect(s.state).toBe("unknown");
    expect(s.start).toBeNull();
    expect(s.end).toBeNull();
  });
});

describe("dayToHoursIndex (JS getDay → 월~일 index)", () => {
  it("월요일(1)→0, 토요일(6)→5, 일요일(0)→6", () => {
    expect(dayToHoursIndex(1)).toBe(0);
    expect(dayToHoursIndex(6)).toBe(5);
    expect(dayToHoursIndex(0)).toBe(6);
  });
});

describe("fetchNightClinics / findNightClinicsNear (fetch 합성)", () => {
  afterEach(() => vi.restoreAllMocks());
  const ok = (json: unknown): Response =>
    ({ ok: true, status: 200, json: async () => json } as unknown as Response);

  it("정상 fixture → 파싱", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fixture));
    const r = await fetchNightClinics();
    expect(r.length).toBe(4);
  });

  it("resultCode != 00 → throw (502)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ response: { header: { resultCode: "03" }, body: {} } }),
    );
    await expect(fetchNightClinics()).rejects.toThrow();
  });

  it("HTTP 실패 → throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(fetchNightClinics()).rejects.toThrow();
  });

  it("totalCount > numOfRows → throw (silent truncation 방지)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ response: { header: { resultCode: "00" }, body: { items: "", totalCount: 999 } } }),
    );
    await expect(fetchNightClinics()).rejects.toThrow();
  });

  it("키 없음(env 비설정) → 빈 배열, fetch 미호출", async () => {
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "";
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await findNightClinicsNear(37.5, 127.0)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "test-key";
  });

  it("findNightClinicsNear: fixture + 좌표 → 거리순 + 거리 부여", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fixture));
    const r = await findNightClinicsNear(37.4979, 127.0276);
    expect(r.length).toBeGreaterThan(0);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].distanceMeters).toBeGreaterThanOrEqual(r[i - 1].distanceMeters);
    }
    expect(Number.isFinite(r[0].distanceMeters)).toBe(true);
  });
});
