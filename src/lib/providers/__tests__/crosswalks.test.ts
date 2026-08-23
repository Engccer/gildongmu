import { describe, expect, it } from "vitest";
import {
  matchCrosswalk,
  matchCrosswalkIn,
  CROSSWALK_MATCH_RADIUS_M,
  type CrosswalkTuple,
} from "../crosswalks";
import seed from "../../data/crosswalks.json";

/**
 * 횡단보도 차로·연장 매칭 3중 게이트(spec 2026-08-23-crosswalk-lanes-length-design.md §3.3).
 * 각 축의 변이를 따로 깨뜨린다 — 실측에서 교차로 중심 한 점에 값 다른 레코드가 겹쳐
 * 있었고(3,425곳), 어느 한 축이 빠지면 틀린 차로 수가 낭독된다.
 */

// 약 20m 남북 구간(위도 0.00018° ≈ 20m). 중점 (37.5000, 126.9500).
const A = { lat: 37.49991, lng: 126.95 };
const B = { lat: 37.50009, lng: 126.95 };
const MID = { lat: 37.5, lng: 126.95 };
/** 중점에서 동쪽으로 meters 떨어진 seed 좌표. */
const east = (meters: number) => [MID.lat, MID.lng + meters / (111_320 * Math.cos((MID.lat * Math.PI) / 180))] as const;

function tuple(lat: number, lng: number, lanes: number, length: number): CrosswalkTuple {
  return [lat, lng, lanes, length];
}

describe("matchCrosswalkIn — 3중 게이트", () => {
  it("30m 안 · 길이 타당 · 단일 후보 → 채택", () => {
    const [lat, lng] = east(10);
    expect(matchCrosswalkIn([A, B], [tuple(lat, lng, 4, 16)])).toEqual({ lanes: 4, lengthM: 16 });
  });

  it("위치 축: 중점에서 반경 밖(31m)이면 침묵 — 길이가 맞아도", () => {
    const [lat, lng] = east(CROSSWALK_MATCH_RADIUS_M + 1);
    expect(matchCrosswalkIn([A, B], [tuple(lat, lng, 4, 18)])).toBeNull();
  });

  it("길이 축: 20m 구간에 연장 2.2m(교차로 옆 횡단보도) → 침묵", () => {
    const [lat, lng] = east(10);
    expect(matchCrosswalkIn([A, B], [tuple(lat, lng, 1, 2.2)])).toBeNull();
  });

  it("길이 축: 허용 띠는 max(5m, 0.4·L) — 20m 구간에 12m는 통과, 11m는 탈락", () => {
    const [lat, lng] = east(10);
    expect(matchCrosswalkIn([A, B], [tuple(lat, lng, 3, 12.5)])).not.toBeNull();
    expect(matchCrosswalkIn([A, B], [tuple(lat, lng, 3, 11)])).toBeNull();
  });

  it("길이 축: 짧은 구간(6m)엔 5m 바닥이 적용돼 9m 연장이 통과한다", () => {
    const a = { lat: 37.499973, lng: 126.95 }, b = { lat: 37.500027, lng: 126.95 };
    expect(matchCrosswalkIn([a, b], [tuple(MID.lat, MID.lng, 1, 9)])).toEqual({ lanes: 1, lengthM: 9 });
  });

  it("합의 축: 같은 점에 차로 수가 다른 두 후보가 모두 타당하면 침묵", () => {
    const [lat, lng] = east(10);
    expect(
      matchCrosswalkIn([A, B], [tuple(lat, lng, 6, 28), tuple(lat, lng, 5, 21)]),
    ).toBeNull();
  });

  it("합의 축: 차로 수가 같고 연장 차 ≤ 2m면 최근접 채택", () => {
    const [lat1, lng1] = east(12);
    const [lat2, lng2] = east(8);
    expect(
      matchCrosswalkIn([A, B], [tuple(lat1, lng1, 1, 17.5), tuple(lat2, lng2, 1, 16)]),
    ).toEqual({ lanes: 1, lengthM: 16 });
  });

  it("합의 축: 차로 수가 같아도 연장 차 > 2m면 침묵", () => {
    const [lat, lng] = east(10);
    expect(
      matchCrosswalkIn([A, B], [tuple(lat, lng, 4, 14), tuple(lat, lng, 4, 19)]),
    ).toBeNull();
  });

  it("타당성에서 탈락한 후보는 합의에 끼지 않는다(겹친 점에서 하나만 남으면 채택)", () => {
    const [lat, lng] = east(10);
    expect(
      matchCrosswalkIn([A, B], [tuple(lat, lng, 3, 13.5), tuple(lat, lng, 1, 6.6)]),
    ).toEqual({ lanes: 3, lengthM: 13.5 });
  });

  it("폴리라인 점이 2개 미만이면 구간 길이를 잴 수 없어 침묵", () => {
    const [lat, lng] = east(0);
    expect(matchCrosswalkIn([MID], [tuple(lat, lng, 4, 16)])).toBeNull();
    expect(matchCrosswalkIn([], [tuple(lat, lng, 4, 16)])).toBeNull();
  });

  it("중점은 양 끝점 기준(중간점이 많아도)", () => {
    const [lat, lng] = east(10);
    const detour = { lat: 37.5, lng: 126.9503 }; // 중간에 26m 동쪽으로 휜 점
    expect(matchCrosswalkIn([A, detour, B], [tuple(lat, lng, 4, 16)])).not.toBeNull();
  });
});

describe("matchCrosswalk — 번들 seed", () => {
  const s = seed as unknown as { crosswalks: CrosswalkTuple[] };

  it("동작구 실측 구간(서달로, 흑석역→중앙대)은 3차로 13.5m로 매칭된다", () => {
    // 2026-08-23 실호출 폴리라인(카카오 "소망 메디컬약국 앞에서 횡단보도 이용", 21.2m)
    const path = [
      { lat: 37.50756321, lng: 126.96171111 },
      { lat: 37.50739593, lng: 126.96159665 },
    ];
    const hit = matchCrosswalk(path);
    expect(hit).toEqual({ lanes: 3, lengthM: 13.5 });
  });

  it("길동(서울 강동구)은 seed가 없어 침묵", () => {
    expect(matchCrosswalk([{ lat: 37.5385, lng: 127.143 }, { lat: 37.5387, lng: 127.143 }])).toBeNull();
  });

  it("seed에 동작구 좌표가 들어 있다", () => {
    expect(s.crosswalks.some(([lat, lng]) => lat > 37.47 && lat < 37.52 && lng > 126.9 && lng < 126.99)).toBe(true);
  });
});
