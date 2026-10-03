import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getKakaoWalkBriefing } from "../providers/kakao-walk";
import { getWalkRoute, getWalkRouteLines } from "../walk-route";
import seed from "../data/audio-signals.json";
import type { Coord, WalkRouteBriefing } from "../types";

/**
 * 판본 2 파이프라인(재작성 → 주석 → 행동 투영, E62 spec §3). 주석은 실제 seed(음향신호기)로 판정한다 —
 * 신호기 좌표 옆에 횡단을 그려 "단일 횡단은 꼬리가 붙고 `parts.body`에도 같은 꼬리" · "분해 조각과 지명 속
 * '횡단보도'에는 붙지 않는다"를 본다.
 */

const signals = (seed as unknown as { signals: [number, number][] }).signals;
const [sigLat, sigLng] = signals[0];
const M = 111320;

/** 신호기 바로 남쪽에서 북쪽으로 걸어와 신호기 위치에서 끝나는 스텝들 + 그 뒤 스텝. */
function north(from: Coord, meters: number): Coord {
  return { lat: from.lat + meters / M, lng: from.lng };
}
function west(from: Coord, meters: number): Coord {
  return { lat: from.lat, lng: from.lng - meters / (M * Math.cos((from.lat * Math.PI) / 180)) };
}

const SIG: Coord = { lat: sigLat, lng: sigLng };
const START = { lat: sigLat - 100 / M, lng: sigLng };

function kakao(steps: WalkRouteBriefing["steps"]): WalkRouteBriefing {
  return { distanceMeters: 300, durationSeconds: 200, steps };
}

beforeEach(() => vi.mocked(getKakaoWalkBriefing).mockReset());

describe("판본 2 파이프라인", () => {
  it("단일 횡단: 주석 꼬리가 문장과 parts.body에 함께 붙고 내부 표식은 응답에 없다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(
      kakao([
        { description: "길동사거리까지 100m 이동(천호대로)", distanceMeters: 100, pathCoords: [START, SIG] },
        { description: "횡단보도 이용", distanceMeters: 20, pathCoords: [SIG, north(SIG, 20)] },
        { description: "50m 이동", distanceMeters: 50, pathCoords: [north(SIG, 20), north(SIG, 70)] },
      ]),
    );
    const r = await getWalkRoute({
      origin: START, dest: north(SIG, 70), lang: "ko", includeGeometry: true, text: { wording: 2, crossingRoad: false },
    });
    const cross = r!.steps[1];
    expect(cross.description).toBe("진행 방향 그대로 횡단보도를 건너세요. 횡단보도 길이 20m, 음향신호기 있음");
    expect(cross.parts).toEqual({ turn: "진행 방향 그대로", body: "횡단보도를 건너세요. 횡단보도 길이 20m, 음향신호기 있음" });
    expect(cross.crossingClock).toBe(12);
    expect(cross.action).toBe("crosswalk");
    for (const s of r!.steps) {
      expect(s).not.toHaveProperty("actionResolved");
      expect(s).not.toHaveProperty("noCrossingNote");
    }
    expect(r!.steps[0].action).toBeUndefined();
  });

  it("분해된 연속 횡단 조각에는 신호기 주석을 붙이지 않는다", async () => {
    const a = north(SIG, 40);
    const b = west(a, 20);
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(
      kakao([
        { description: "교차로까지 100m 이동", distanceMeters: 100, pathCoords: [{ lat: SIG.lat, lng: SIG.lng + 100 / (M * 0.79) }, SIG] },
        { description: "교차로에서 2개의 횡단보도 이용", distanceMeters: 60, pathCoords: [SIG, a, b] },
      ]),
    );
    const r = await getWalkRoute({
      origin: START, dest: b, lang: "ko", includeGeometry: true, text: { wording: 2, crossingRoad: false },
    });
    expect(r!.steps).toHaveLength(3);
    for (const s of r!.steps.slice(1)) {
      expect(s.description).not.toContain("음향신호기");
      expect(s.crossing).toBe(true);
    }
  });

  it("이동 문장의 지명 속 '횡단보도'에는 행동도 주석도 없다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(
      kakao([{ description: "천호역 횡단보도에서 100m 이동(천호대로)", distanceMeters: 100, pathCoords: [START, SIG] }]),
    );
    const r = await getWalkRoute({
      origin: START, dest: SIG, lang: "ko", includeGeometry: true, text: { wording: 2, crossingRoad: false },
    });
    expect(r!.steps[0].description).toBe("천호역 횡단보도에서 천호대로를 따라 100m 이동");
    expect(r!.steps[0].action).toBeUndefined();
  });

  it("기하 없는 응답(줄 목록)은 문장만 바뀌고 조각 필드가 없다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(
      kakao([
        { description: "길동사거리까지 100m 이동(천호대로)", distanceMeters: 100, pathCoords: [START, SIG] },
        { description: "횡단보도 이용", distanceMeters: 20, pathCoords: [SIG, north(SIG, 20)] },
      ]),
    );
    const { lines } = await getWalkRouteLines({
      origin: START, dest: north(SIG, 20), lang: "ko", version: 2, text: { wording: 2, crossingRoad: false },
    });
    const steps = lines[0].route.steps;
    expect(steps[0].description).toBe("천호대로를 따라 길동사거리까지 100m 이동");
    expect(steps[1].description).toBe("진행 방향 그대로 횡단보도를 건너세요. 횡단보도 길이 20m, 음향신호기 있음");
    for (const s of steps) {
      for (const k of ["parts", "crossingClock", "action", "crossing", "live", "pathCoords", "actionResolved"]) {
        expect(s).not.toHaveProperty(k);
      }
    }
  });
});
