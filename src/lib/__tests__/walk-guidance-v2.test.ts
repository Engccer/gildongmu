import { describe, expect, it } from "vitest";
import { rewriteWalkBriefingV2, type WalkWordingV2Options } from "../walk-guidance";
import type { Coord, WalkRouteBriefing, WalkRouteStep } from "../types";

/**
 * 판본 2 문장 틀(E62 spec `2026-10-03-crosswalk-guidance-design.md` §3). 기대값은 문안 확정본
 * (`2026-10-03-guidance-wording-confirmed.md`) 예문 그대로다 — 새로 지은 문장이 아니다. 원문 입력은 카카오 문형.
 * 기하는 남→북 기준 좌표계에 방위·길이로 그린 합성 폴리라인이다(방향 판정은 상대 방위만 본다).
 */

const M_PER_DEG_LAT = 111320;

/** 시작점에서 (방위°, 길이 m) 선분들을 이어 그린 폴리라인. */
function path(start: Coord, legs: [number, number][]): Coord[] {
  const out = [start];
  let { lat, lng } = start;
  for (const [bearing, len] of legs) {
    const rad = (bearing * Math.PI) / 180;
    lat += (len * Math.cos(rad)) / M_PER_DEG_LAT;
    lng += (len * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    out.push({ lat, lng });
  }
  return out;
}

/** 스텝을 이어 그린다: 각 스텝은 앞 스텝 끝에서 시작한다. */
function route(steps: { desc: string; m: number; legs: [number, number][] }[]): WalkRouteBriefing {
  let cursor: Coord = { lat: 37.5, lng: 127.1 };
  const out: WalkRouteStep[] = steps.map((s) => {
    const pc = path(cursor, s.legs);
    cursor = pc[pc.length - 1];
    return { description: s.desc, distanceMeters: s.m, pathCoords: pc };
  });
  return { distanceMeters: 0, durationSeconds: 0, steps: out };
}

const LIVE: WalkWordingV2Options = { includeLive: true, geometry: true, crossingRoad: false };
const ROAD: WalkWordingV2Options = { includeLive: true, geometry: true, crossingRoad: true };

/** 북쪽(0°)으로 걷던 이동 스텝 — 횡단의 기준 방향. */
const WALK_NORTH = { desc: "길동사거리앞교차로까지 100m 이동(천호대로)", m: 100, legs: [[0, 100]] as [number, number][] };

describe("판본 2 이동 문장(문안 가)", () => {
  it("방향 변화 없는 구간: 길을 따라 → 어디까지 → 거리", () => {
    const r = rewriteWalkBriefingV2(route([{ desc: "강동역사거리까지 380m 이동(천호대로)", m: 380, legs: [[0, 380]] }]), LIVE);
    expect(r.steps[0].description).toBe("천호대로를 따라 강동역사거리까지 380m 이동");
    expect(r.steps[0].parts).toBeUndefined();
  });

  it("조회 화면 줄 목록 예문: 어디서 → 길을 따라 → 어디까지 → 거리", () => {
    const r = rewriteWalkBriefingV2(
      route([{ desc: "길동사거리에서 길동사거리앞교차로까지 128m 이동(천호대로)", m: 128, legs: [[0, 128]] }]),
      { includeLive: false, geometry: true, crossingRoad: false },
    );
    expect(r.steps[0].description).toBe("길동사거리에서 천호대로를 따라 길동사거리앞교차로까지 128m 이동");
  });

  it("회전은 끊어 말한다 — 회전 문장과 이동 문장이 조각으로 갈린다", () => {
    const r = rewriteWalkBriefingV2(
      route([
        WALK_NORTH,
        { desc: "편의점까지 왼쪽길로 37m 이동(성내로)", m: 37, legs: [[270, 37]] },
        { desc: "카페 앞에서 오른쪽길로 82m 이동", m: 82, legs: [[0, 82]] },
      ]),
      LIVE,
    );
    expect(r.steps[1].description).toBe("왼쪽으로 도세요. 그 후 성내로를 따라 편의점까지 37m 이동");
    expect(r.steps[1].parts).toEqual({ turn: "왼쪽으로 도세요", body: "성내로를 따라 편의점까지 37m 이동" });
    expect(r.steps[1].action).toBe("left");
    expect(r.steps[2].description).toBe("카페 앞에서 오른쪽으로 도세요. 그 후 82m 이동");
    expect(r.steps[2].parts).toEqual({ turn: "카페 앞에서 오른쪽으로 도세요", body: "82m 이동" });
    expect(r.steps[2].action).toBe("right");
    expect(r.steps[2].live).toEqual({ anchor: "카페" });
  });

  it("행동 없는 이동 문장은 행동 없음으로 확정한다(지명 속 '횡단보도'가 분류되지 않는다)", () => {
    const r = rewriteWalkBriefingV2(route([{ desc: "천호역 횡단보도에서 100m 이동(천호대로)", m: 100, legs: [[0, 100]] }]), LIVE);
    expect(r.steps[0].action).toBeUndefined();
    expect(r.steps[0].actionResolved).toBe(true);
  });

  it("Tmap ko 폴백 문장은 원문 그대로다", () => {
    const raw = "우회전 후 진황도로를 따라 294m 이동";
    const r = rewriteWalkBriefingV2(route([{ desc: raw, m: 294, legs: [[0, 294]] }]), { ...LIVE, geometry: false });
    expect(r.steps[0].description).toBe(raw);
  });
});

describe("판본 2 횡단 문장(문안 나)", () => {
  it("그대로 건넘, 장소 앞", () => {
    const r = rewriteWalkBriefingV2(
      route([WALK_NORTH, { desc: "김종하 정신과의원 앞에서 횡단보도 이용", m: 10, legs: [[5, 10]] }]),
      LIVE,
    );
    expect(r.steps[1].description).toBe("김종하 정신과의원 앞에서 진행 방향 그대로 횡단보도를 건너세요. 횡단보도 길이 10m");
    expect(r.steps[1].parts).toEqual({
      turn: "진행 방향 그대로",
      body: "김종하 정신과의원 앞에서 횡단보도를 건너세요. 횡단보도 길이 10m",
    });
    expect(r.steps[1].crossingClock).toBe(12);
    expect(r.steps[1].action).toBe("crosswalk");
    expect(r.steps[1].crossing).toBe(true);
  });

  it("그대로 건넘, 향하는 곳 있음 — '까지'가 '을/를 향해'로", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "길동사거리까지 횡단보도 이용", m: 8, legs: [[355, 8]] }]), LIVE);
    expect(r.steps[1].description).toBe("길동사거리를 향해 진행 방향 그대로 횡단보도를 건너세요. 횡단보도 길이 8m");
  });

  it("틀어서 건넘, 길 이름 앎(옵트인)", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "횡단보도 이용", m: 47, legs: [[270, 47]] }]), ROAD);
    expect(r.steps[1].description).toBe("9시 방향으로 도세요. 그 후 천호대로를 건너세요. 횡단보도 길이 47m");
    expect(r.steps[1].parts).toEqual({ turn: "9시 방향으로 도세요", body: "천호대로를 건너세요. 횡단보도 길이 47m" });
    expect(r.steps[1].crossingClock).toBe(9);
  });

  it("틀어서 건넘, 길 이름 모름(옵트인 꺼짐이면 길 이름을 싣지 않는다)", () => {
    const steps = [WALK_NORTH, { desc: "길동사거리까지 횡단보도 이용", m: 8, legs: [[300, 8]] as [number, number][] }];
    const expected = "10시 방향으로 도세요. 그 후 길동사거리를 향해 횡단보도를 건너세요. 횡단보도 길이 8m";
    expect(rewriteWalkBriefingV2(route(steps), LIVE).steps[1].description).toBe(expected);
    // 옵트인이어도 직각 안팎(60~120°)이 아니면(60° 미만 비스듬) 길 이름 추론을 하지 않는다.
    expect(rewriteWalkBriefingV2(route(steps), ROAD).steps[1].description).toBe(expected);
  });

  it("6시는 '뒤로 도세요'", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "횡단보도 이용", m: 12, legs: [[180, 12]] }]), LIVE);
    expect(r.steps[1].description).toBe("뒤로 도세요. 그 후 횡단보도를 건너세요. 횡단보도 길이 12m");
    expect(r.steps[1].crossingClock).toBe(6);
  });

  it("방향 모름(첫 스텝이 횡단): 방향 구절 없이", () => {
    const r = rewriteWalkBriefingV2(route([{ desc: "길동사거리까지 횡단보도 이용", m: 8, legs: [[90, 8]] }]), LIVE);
    expect(r.steps[0].description).toBe("길동사거리를 향해 횡단보도를 건너세요. 횡단보도 길이 8m");
    expect(r.steps[0].parts).toBeUndefined();
    expect(r.steps[0].crossingClock).toBeUndefined();
  });

  it("기준 방향은 직전 스텝 끝의 연석 꼬리가 아니라 보도 본선이다", () => {
    // 본선 84.6m 북쪽 → 9m 동쪽 꼬리 → 횡단은 본선 대비 그대로(꼬리 대비 9시)
    const r = rewriteWalkBriefingV2(
      route([{ desc: "교촌치킨까지 94m 이동", m: 94, legs: [[0, 84.6], [90, 9]] }, { desc: "횡단보도 이용", m: 20, legs: [[356, 20]] }]),
      LIVE,
    );
    expect(r.steps[1].crossingClock).toBe(12);
  });

  it("지하보도는 같은 틀이고 방향을 싣지 않는다", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "지하보도 이용", m: 30, legs: [[270, 30]] }]), LIVE);
    expect(r.steps[1].description).toBe("지하보도로 건너세요. 지하보도 길이 30m");
    expect(r.steps[1].crossingClock).toBeUndefined();
    expect(r.steps[1].action).toBe("underpass");
  });

  it("Tmap 기하(geometry 꺼짐)로는 방향을 정하지 않는다", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "횡단보도 이용", m: 20, legs: [[270, 20]] }]), { ...LIVE, geometry: false });
    expect(r.steps[1].description).toBe("횡단보도를 건너세요. 횡단보도 길이 20m");
  });
});

describe("판본 2 연속 횡단", () => {
  // 강동성심병원교차로 형태: 47m(9시) → 섬 6.3m·3.7m → 21m(앞 횡단 대비 3시)
  const KANGDONG = [
    { desc: "강동성심병원교차로까지 100m 이동(천호대로)", m: 100, legs: [[112, 100]] as [number, number][] },
    { desc: "강동성심병원교차로에서 2개의 횡단보도 이용", m: 77, legs: [[22, 46.7], [74, 6.3], [44, 3.7], [114, 20.8]] as [number, number][] },
    { desc: "50m 이동", m: 50, legs: [[114, 50]] as [number, number][] },
  ];

  it("처음 한 번(개수 예고) 뒤 하나씩 — 확정본 예문 그대로", () => {
    const r = rewriteWalkBriefingV2(route(KANGDONG), ROAD);
    expect(r.steps).toHaveLength(4);
    expect(r.steps[1].description).toBe(
      "강동성심병원교차로에서 횡단보도 2개를 연속으로 건넙니다. 먼저 9시 방향으로 도세요. 그 후 천호대로를 건너세요. 횡단보도 길이 47m",
    );
    expect(r.steps[1].parts).toEqual({ turn: "9시 방향으로 도세요", body: "천호대로를 건너세요. 횡단보도 길이 47m" });
    expect(r.steps[2].description).toBe("3시 방향으로 도세요. 그 후 다음 횡단보도를 건너세요. 횡단보도 길이 21m");
    for (const s of r.steps.slice(1, 3)) {
      expect(s.crossing).toBe(true);
      expect(s.action).toBe("crosswalk");
      expect(s.noCrossingNote).toBe(true);
    }
    // 거리 합 보존, 이음매 공유(조각 끝점 = 다음 조각 첫 점)
    expect((r.steps[1].distanceMeters ?? 0) + (r.steps[2].distanceMeters ?? 0)).toBe(77);
    const a = r.steps[1].pathCoords!;
    expect(r.steps[2].pathCoords![0]).toEqual(a[a.length - 1]);
  });

  it("경유지 인덱스를 늘어난 조각 수만큼 민다", () => {
    const b = { ...route(KANGDONG), waypoint: { stepIndex: 2, coord: { lat: 0, lng: 0 } } };
    expect(rewriteWalkBriefingV2(b, LIVE).waypoint?.stepIndex).toBe(3);
    const at = { ...route(KANGDONG), waypoint: { stepIndex: 1, coord: { lat: 0, lng: 0 } } };
    expect(rewriteWalkBriefingV2(at, LIVE).waypoint?.stepIndex).toBe(1);
  });

  it("첫 조각이 가장 길지 않으면 길 이름을 싣지 않는다(길동사거리: 9.4m 뒤 50m)", () => {
    const r = rewriteWalkBriefingV2(
      route([
        { desc: "길동사거리까지 100m 이동(천호대로)", m: 100, legs: [[66, 100]] },
        { desc: "길동사거리에서 2개의 횡단보도 이용", m: 60, legs: [[162, 9.4], [107, 50.3]] },
      ]),
      ROAD,
    );
    expect(r.steps[1].description).toBe(
      "길동사거리에서 횡단보도 2개를 연속으로 건넙니다. 먼저 3시 방향으로 도세요. 그 후 횡단보도를 건너세요. 횡단보도 길이 9m",
    );
    expect(r.steps[2].description).toBe("10시 방향으로 도세요. 그 후 다음 횡단보도를 건너세요. 횡단보도 길이 50m");
  });

  it("나눌 수 없으면 한 문장, 길이 라벨 '전체 길이'(위원장 판정 2026-10-03)", () => {
    const r = rewriteWalkBriefingV2(
      route([WALK_NORTH, { desc: "대명초교입구에서 2개의 횡단보도 이용", m: 12, legs: [[0, 12.9]] }]),
      LIVE,
    );
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].description).toBe("대명초교입구에서 진행 방향 그대로 횡단보도 2개를 연속으로 건너세요. 전체 길이 12m");
    const turnedSteps = route([WALK_NORTH, { desc: "신명초교입구교차로에서 봄봄약국까지 2개의 횡단보도 이용", m: 30, legs: [[270, 30.1]] }]);
    expect(rewriteWalkBriefingV2(turnedSteps, LIVE).steps[1].description).toBe(
      "신명초교입구교차로에서 9시 방향으로 도세요. 그 후 봄봄약국을 향해 횡단보도 2개를 연속으로 건너세요. 전체 길이 30m",
    );
  });
});

describe("판본 2 조각 필드 게이트·조립 관계", () => {
  it("includeLive가 아니면 live·crossing·parts·crossingClock를 싣지 않는다", () => {
    const r = rewriteWalkBriefingV2(route([WALK_NORTH, { desc: "횡단보도 이용", m: 47, legs: [[270, 47]] }]), {
      includeLive: false,
      geometry: true,
      crossingRoad: false,
    });
    for (const s of r.steps) {
      expect(s.parts).toBeUndefined();
      expect(s.crossingClock).toBeUndefined();
      expect(s.crossing).toBeUndefined();
      expect(s.live).toBeUndefined();
    }
  });

  it("회전 조각은 '{turn}. 그 후 {body}'로 문장을 이룬다", () => {
    const r = rewriteWalkBriefingV2(
      route([
        WALK_NORTH,
        { desc: "편의점까지 왼쪽길로 37m 이동(성내로)", m: 37, legs: [[270, 37]] },
        { desc: "횡단보도 이용", m: 20, legs: [[0, 20]] },
        { desc: "지하보도 이용", m: 30, legs: [[90, 30]] },
      ]),
      ROAD,
    );
    for (const s of r.steps) {
      if (!s.parts) continue;
      if (s.parts.turn === "진행 방향 그대로") {
        expect(s.description.replace("진행 방향 그대로 ", "")).toBe(s.parts.body);
      } else {
        expect(s.description.endsWith(`${s.parts.turn}. 그 후 ${s.parts.body}`)).toBe(true);
      }
    }
  });
});
