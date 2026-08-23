import type { GuideAction } from "./walk-action";

/**
 * Tmap **보행자** `turnType` → 결정 지점 행동 + 영어 안내 문구(순수, ko 무관).
 * 자동차판은 `car-action.ts` — 그쪽은 행동만 내지만 이쪽은 **문구까지 같은 항목에서** 낸다.
 *
 * ⚠ **표를 둘로 나누지 않는 것이 이 모듈의 존재 이유다**(설계 리뷰 #2, spec
 * `2026-08-23-non-ko-walk-guidance-design.md` §4.2). 행동표와 문장표를 따로 두면 같은 코드가
 * 두 번 분류되어 "문장은 좌회전인데 임박 톤은 우회전"이 가능해지고, 각 표의 코드 커버리지
 * 테스트를 둘 다 통과해도 그 불일치는 잡히지 않는다.
 *
 * ⚠ **시계 방위를 좌우로 접지 않는다**(설계 리뷰 #8). 8·10·2·4시는 갈림길에서 어느 가지인지
 * 지목하는 정보라 `Bear left`로 옮기면 다른 길로 진입시킬 수 있다.
 *
 * ⚠ **공식 표는 관측으로 반증됐다**: 공식 표(readme.io "경로안내 샘플예제", 2026-08-23 확인)는
 * 경유지를 184~189로 적었지만 실호출 PP1 지점은 `turnType 0`이다. 그래서 이 표는 공식 표와
 * 30경로 435스텝 코퍼스의 **합집합**이다. 표에 없는 코드는 `null`이고 호출부가 throw한다 —
 * 낭독 채널에서 행동절을 빠뜨린 문장은 *회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다.
 */
export interface PedestrianStep {
  /** 임박 큐 행동. `null`은 판정 결과(행동 없음)이지 미분류가 아니다. */
  action: GuideAction | null;
  /** 영어 행동절. `null`이면 문장에 행동절이 없다(직진·출발·경유지). */
  phrase: string | null;
}

const NO_ACTION: PedestrianStep = { action: null, phrase: null };

const TABLE: Readonly<Record<number, PedestrianStep>> = {
  // 안내 없음(1~7)·직진(11)·출발(200)·직진 임시(233)·경유지(0, 184~189).
  // ⚠ 0은 공식 표에 없지만 PP1 실관측이다. 경유지 구획 문장은 서버가 만들지 않으므로(N4 계약)
  // 경유지도 "행동절 없음"이다 — 구획은 소비자가 `waypoint.stepIndex` 자리에 그린다.
  0: NO_ACTION,
  1: NO_ACTION,
  2: NO_ACTION,
  3: NO_ACTION,
  4: NO_ACTION,
  5: NO_ACTION,
  6: NO_ACTION,
  7: NO_ACTION,
  11: NO_ACTION,
  200: NO_ACTION,
  233: NO_ACTION,
  184: NO_ACTION,
  185: NO_ACTION,
  186: NO_ACTION,
  187: NO_ACTION,
  188: NO_ACTION,
  189: NO_ACTION,

  12: { action: "left", phrase: "Turn left" },
  13: { action: "right", phrase: "Turn right" },
  14: { action: "back", phrase: "Make a U-turn" },
  16: { action: "left", phrase: "Turn to your 8 o'clock" },
  17: { action: "left", phrase: "Turn to your 10 o'clock" },
  18: { action: "right", phrase: "Turn to your 2 o'clock" },
  19: { action: "right", phrase: "Turn to your 4 o'clock" },

  // 시설: 문구는 있고 행동(톤)은 없다. 육교를 `underpass`로 접으면 "지하보도로 건너세요"가
  // 나가 거짓이고, 계단·엘리베이터에 `crosswalk` 톤을 붙이면 음향신호기 비프의 거짓 인용이 된다.
  125: { action: null, phrase: "Take the pedestrian overpass" },
  126: { action: "underpass", phrase: "Take the underpass" },
  127: { action: null, phrase: "Take the stairs" },
  128: { action: null, phrase: "Take the ramp" },
  129: { action: null, phrase: "Take the stairs or the ramp" },
  218: { action: null, phrase: "Take the elevator" },

  211: { action: "crosswalk", phrase: "Cross the crosswalk" },
  212: { action: "crosswalk", phrase: "Cross the crosswalk on your left" },
  213: { action: "crosswalk", phrase: "Cross the crosswalk on your right" },
  214: { action: "crosswalk", phrase: "Cross the crosswalk at 8 o'clock" },
  215: { action: "crosswalk", phrase: "Cross the crosswalk at 10 o'clock" },
  216: { action: "crosswalk", phrase: "Cross the crosswalk at 2 o'clock" },
  217: { action: "crosswalk", phrase: "Cross the crosswalk at 4 o'clock" },

  201: { action: null, phrase: "Arrive at your destination" },
};

/** 표에 있는 전 코드 — 표 오타 가드 테스트가 순회한다. */
export const PEDESTRIAN_TURN_TYPES: readonly number[] = Object.keys(TABLE).map(Number);

/** 표에 없으면 `null` — 호출부가 throw한다(추측 금지). */
export function pedestrianStepFor(turnType: number): PedestrianStep | null {
  return TABLE[turnType] ?? null;
}
