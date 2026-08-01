import { describe, expect, it } from "vitest";
import {
  MATCH_RADIUS_METERS,
  findCongestionArea,
  listCongestionAreas,
} from "../congestion-area";

/**
 * 스펙 §1-4 8지점 실측을 그대로 fixture로 굳힌다. 이 표가 깨지면 임계값이
 * 아니라 **판정 축**을 의심해야 한다(스펙 §7) — 150~500m 전 구간이 같은
 * 답을 냈으므로 임계값 조정은 증상 치료다.
 */
describe("findCongestionArea — 실측 8지점", () => {
  it.each([
    ["길동 주택가(최근접 1,319m)", 37.538, 127.142, null],
    ["강동역(최근접 676m)", 37.5354, 127.1325, null],
    ["일산, 서울 밖(최근접 10.5km)", 37.6584, 126.77, null],
    ["강남역 11번 출구(29m)", 37.4979, 127.0276, "강남역"],
    ["성수동 카페거리(25m)", 37.5445, 127.0557, "성수카페거리"],
    ["여의도 IFC(120m)", 37.5254, 126.9256, "여의도"],
  ])("%s", (_label, lat, lng, expected) => {
    expect(findCongestionArea(lat, lng)?.name ?? null).toBe(expected);
  });

  it("중첩되면 중심이 가장 가까운 영역을 고른다(잠실역 1번 출구)", () => {
    // 잠실 관광특구·잠실롯데타워·잠실역이 모두 7m로 동률이지만
    // 중심 거리는 78m < 527m < 893m라 가장 국소적인 영역이 답이다.
    expect(findCongestionArea(37.5133, 127.1001)?.name).toBe("잠실역");
  });

  it("홍대도 관광특구가 아니라 더 국소적인 역 영역을 고른다", () => {
    expect(findCongestionArea(37.5561, 126.9236)?.name).toBe("홍대입구역(2호선)");
  });
});

describe("임계값 경계", () => {
  /** 모든 영역의 모든 지점 중 최근접 거리 — 판정의 정의 그 자체. */
  function nearestPointMeters(lat: number, lng: number) {
    let min = Infinity;
    for (const a of listCongestionAreas()) {
      for (const [plat, plng] of a.pts) {
        const d = haversine(lat, lng, plat, plng);
        if (d < min) min = d;
      }
    }
    return min;
  }

  /**
   * 계약: 매칭 여부는 "최근접 구성 지점 ≤ 300m"와 **정확히 동치**다.
   * 격자로 훑어 동치가 깨지는 지점이 하나도 없음을 확인한다. 임계값 근처
   * 좌표를 손으로 고르면 "다른 지점이 더 가까워서" 판정이 흐려지지만,
   * 동치 자체를 검사하면 그 흔들림이 사라진다.
   */
  it("매칭 여부는 최근접 지점 300m 이내와 동치다(서울 격자 전수)", () => {
    const mismatches: string[] = [];
    for (let lat = 37.44; lat <= 37.7; lat += 0.004) {
      for (let lng = 126.78; lng <= 127.18; lng += 0.005) {
        const matched = findCongestionArea(lat, lng) !== null;
        const within = nearestPointMeters(lat, lng) <= MATCH_RADIUS_METERS;
        if (matched !== within) {
          mismatches.push(`${lat.toFixed(4)},${lng.toFixed(4)} 판정=${matched} 거리내=${within}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("임계값 상수는 300m다(스펙 §1-4: 서울 격자의 8.9%)", () => {
    expect(MATCH_RADIUS_METERS).toBe(300);
  });
});

describe("seed 무결성", () => {
  it("116개 영역이 로드된다", () => {
    expect(listCongestionAreas()).toHaveLength(116);
  });

  it("모든 영역이 지점을 하나 이상 가진다(지점 0개는 seed 단계에서 탈락)", () => {
    expect(listCongestionAreas().every((a) => a.pts.length > 0)).toBe(true);
  });
});

function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
