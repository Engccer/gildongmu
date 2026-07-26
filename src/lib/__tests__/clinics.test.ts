import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClinicHours, NightClinic } from "@/lib/types";

// env는 import 시점 동결 — 両키 있음으로 모킹(케이스별로 덮는다).
vi.mock("@/lib/env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key", KAKAO_REST_API_KEY: "kakao-key" },
  hasDataGoKrKey: () => true,
}));
vi.mock("@/lib/providers/holiday", () => ({
  fetchIsHoliday: vi.fn(async () => false),
}));
// 정본 소스(달빛)만 mock — rank·상태·정렬 로직은 실제 구현을 쓴다.
vi.mock("@/lib/providers/night-clinic", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchNightClinics: vi.fn(async () => []),
}));
vi.mock("@/lib/providers/pediatric-clinics", () => ({
  fetchPediatricClinicsBySido: vi.fn(async () => []),
}));
vi.mock("@/lib/region-scan", () => ({
  scanSidos: vi.fn(async () => ["서울특별시"]),
}));

const { findNightClinicsNow } = await import("@/lib/clinics");
const { fetchNightClinics } = await import("@/lib/providers/night-clinic");
const { fetchPediatricClinicsBySido } = await import(
  "@/lib/providers/pediatric-clinics"
);
const { scanSidos } = await import("@/lib/region-scan");
const { env } = await import("@/lib/env");

const mockDesignated = vi.mocked(fetchNightClinics);
const mockSupplement = vi.mocked(fetchPediatricClinicsBySido);
const mockScan = vi.mocked(scanSidos);

/** 전 요일 09~18 진료 기관. lat 오프셋으로 거리를 만든다(0.001도 ≈ 111m). */
function clinic(
  id: string,
  latOffset: number,
  over: Partial<NightClinic> = {},
): NightClinic {
  const hours: ClinicHours[] = Array.from({ length: 8 }, () => ({
    start: 900,
    end: 1800,
  }));
  return {
    id,
    name: id,
    address: "서울특별시 강동구 성내로 1",
    phone: "02-000-0000",
    kind: "의원",
    emergencyClass: "응급의료기관 이외",
    directions: "",
    lat: 37.5301 + latOffset,
    lng: 127.1238,
    distanceMeters: Number.POSITIVE_INFINITY,
    hours,
    designated: true,
    ...over,
  };
}

const 강동구청 = { lat: 37.5301, lng: 127.1238 };
/** 정오(KST) — 09~18 진료 기관이 open으로 판정되는 시각. */
const NOON_KST = Date.UTC(2026, 6, 24, 3, 0); // 금요일 12:00 KST

function run(opts: { nowMs?: number } = {}) {
  return findNightClinicsNow(강동구청.lat, 강동구청.lng, {
    nowMs: opts.nowMs ?? NOON_KST,
  });
}

describe("findNightClinicsNow (지정+보완 병합)", () => {
  beforeEach(() => {
    mockDesignated.mockReset().mockResolvedValue([]);
    mockSupplement.mockReset().mockResolvedValue([]);
    mockScan.mockReset().mockResolvedValue(["서울특별시"]);
    (env as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY = "kakao-key";
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "test-key";
  });

  it("두 소스를 병합하고 소스별 수·반경을 따로 밝힌다", async () => {
    mockDesignated.mockResolvedValue([clinic("달빛", 0.01)]); // 1.1km
    mockSupplement.mockResolvedValue([
      clinic("동네소아과", 0.005, { designated: false }), // 0.6km
    ]);
    const r = await run();
    expect(r.total).toBe(2);
    expect(r.designatedTotal).toBe(1);
    expect(r.supplementTotal).toBe(1);
    expect(r.radiusMeters).toBe(20_000);
    expect(r.supplementRadiusMeters).toBe(3_000);
    expect(r.supplementFailed).toBe(false);
  });

  it("병합 후 같은 상태 안에서는 거리순 — 가까운 보완 기관이 먼 지정 기관보다 앞", async () => {
    mockDesignated.mockResolvedValue([clinic("달빛", 0.01)]);
    mockSupplement.mockResolvedValue([
      clinic("동네소아과", 0.005, { designated: false }),
    ]);
    const r = await run();
    expect(r.clinics.map((c) => c.name)).toEqual(["동네소아과", "달빛"]);
  });

  it("보완 소스는 3km 밖을 버린다 — 지정 20km와 반경이 다르다", async () => {
    mockDesignated.mockResolvedValue([clinic("달빛10km", 0.09)]); // ~10km
    mockSupplement.mockResolvedValue([
      clinic("소아과5km", 0.045, { designated: false }), // ~5km > 3km
    ]);
    const r = await run();
    expect(r.clinics.map((c) => c.name)).toEqual(["달빛10km"]);
    expect(r.supplementTotal).toBe(0);
  });

  it("hpid 중복은 지정 명부가 이긴다(designated 라벨 보존)", async () => {
    mockDesignated.mockResolvedValue([clinic("같은병원", 0.001)]);
    mockSupplement.mockResolvedValue([
      clinic("같은병원", 0.001, { designated: false }),
    ]);
    const r = await run();
    expect(r.total).toBe(1);
    expect(r.clinics[0].designated).toBe(true);
  });

  it("보완 소스 실패는 supplementFailed로 표기하고 지정 명부는 산다", async () => {
    mockDesignated.mockResolvedValue([clinic("달빛", 0.001)]);
    mockSupplement.mockRejectedValue(new Error("HTTP 500"));
    const r = await run();
    expect(r.supplementFailed).toBe(true);
    expect(r.clinics.map((c) => c.name)).toEqual(["달빛"]);
  });

  it("시도 스캔 전멸도 보완 실패로 표기한다(빈 시도 ≠ 보완 0곳)", async () => {
    mockDesignated.mockResolvedValue([clinic("달빛", 0.001)]);
    mockScan.mockResolvedValue([]);
    const r = await run();
    expect(r.supplementFailed).toBe(true);
    expect(mockSupplement).not.toHaveBeenCalled();
  });

  it("카카오 키 없음 → 보완 기능 자체가 꺼진다(실패 아님, 게이트)", async () => {
    (env as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY = "";
    mockDesignated.mockResolvedValue([clinic("달빛", 0.001)]);
    const r = await run();
    expect(r.supplementFailed).toBe(false);
    expect(r.supplementTotal).toBe(0);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("정본(달빛) 실패는 throw — 빈 목록으로 위장하지 않는다", async () => {
    mockDesignated.mockRejectedValue(new Error("HTTP 502"));
    await expect(run()).rejects.toThrow();
  });

  it("시도가 여럿이면 시도별로 보완 소스를 부른다", async () => {
    mockScan.mockResolvedValue(["서울특별시", "경기도"]);
    mockDesignated.mockResolvedValue([]);
    await run();
    expect(mockSupplement).toHaveBeenCalledWith("서울특별시");
    expect(mockSupplement).toHaveBeenCalledWith("경기도");
  });

  it("data.go.kr 키 없음 → 전체 빈 결과, 어떤 소스도 부르지 않는다", async () => {
    (env as { DATA_GO_KR_API_KEY?: string }).DATA_GO_KR_API_KEY = "";
    const r = await run();
    expect(r).toMatchObject({ clinics: [], total: 0, supplementFailed: false });
    expect(mockDesignated).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("서버 상한 50 — 표시 절단은 클라이언트 몫, 절단 전 수는 total로 보존", async () => {
    // 3km 내 보완 기관 60곳(전부 진료중) → 50개 반환, total 60.
    mockSupplement.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) =>
        clinic(`소아과${i}`, 0.0001 * (i + 1), { designated: false }),
      ),
    );
    const r = await run();
    expect(r.clinics.length).toBe(50);
    expect(r.total).toBe(60);
  });
});
