// 조사 판정은 공용 모듈이 정본이다(walk-guidance 동형) — 사본 금지.
import { objectParticle } from "./korean-particle";
import type { CarRouteBriefing } from "./types";

/**
 * Tmap 자동차 안내문 재작성(순수 함수, ko 전용). 문체 판정은 위원장(2026-08-10).
 *
 * Tmap 문형은 하나뿐이다(전국 12경로 212문장 전수 조사):
 * `{지점}에서 {방면}으로 {행동} 후 {도로}를 따라 {거리} 이동`.
 * `{행동}` 자리에 회전 유형(turnType)별 어휘가 가공 없이 들어가는데, 동작성
 * 명사(우회전·좌회전·U턴)는 「후」와 자연스럽지만 상태·위치 명사가 오면 결합이
 * 깨진다 — "오른쪽 방향 후"(실사용 리포트), "터널 후", "고가도로옆 후".
 * 코퍼스의 53%(112/212)가 이 계열이라 예외가 아니라 다수파다.
 *
 * ⚠ **"오른쪽 방향"을 "우회전"으로 바꾸지 말 것.** 코퍼스 실측으로 이 어휘는
 * 48%(왼쪽은 69%)가 같은 도로로 이어진다(올림픽대로→올림픽대로) — 교차로 회전이
 * 아니라 자동차전용도로에서 갈래를 고르는 지시다. 회전 어휘로 바꾸면 문장은
 * 자연스러워지고 의미가 틀린다(어색함보다 나쁜 안전 결함).
 *
 * ⚠ **미매칭 문장은 원문 그대로 통과시킨다(fail-safe, walk-guidance 동형).**
 * Tmap이 새 어휘를 내면 그 문장만 종전대로 낭독되고 나머지는 정상이다. 회전
 * 계열·출발(200)·도착(201)·카카오 폴백 문형(꼬리 없음)도 같은 경로로 보존된다.
 *
 * 재작성은 `{행동} 후` 어절만 동사구로 바꾸고 도로명·거리 꼬리는 원문 그대로
 * 둔다 — 거리 표기는 Tmap 원문 표기(정수 m)를 유지한다(표기 축은 별도 판정).
 */

/** 「후」와 자연스럽게 결합하는 동작성 명사 — 손대지 않는다. */
const KEEP = /^(?:\d+시 방향 )?(?:좌회전|우회전|U턴)$/;

/**
 * 상태·위치 명사 → 동사구 매핑. 「후」는 동사구가 흡수한다.
 * "방향"류는 "길로 들어선 뒤"(분기 선택), 시설류는 "…를 지나"(통과).
 */
const ACTION_MAP: Record<string, string> = {
  "오른쪽 방향": "오른쪽 길로 들어선 뒤",
  "왼쪽 방향": "왼쪽 길로 들어선 뒤",
  터널: "터널을 지나",
  졸음쉼터: "졸음쉼터를 지나",
  지하차도: "지하차도를 지나",
  고가도로: "고가도로를 지나",
  고가도로옆: "고가도로 옆길로 들어선 뒤",
  지하차도옆: "지하차도 옆길로 들어선 뒤",
};

/**
 * 고속도로 입구·출구 일반 규칙(101/103/104/111/113/114 + 미관측 좌우 대칭).
 * [1] 방위(오른쪽|왼쪽|전방) [2] 도로 종별 [3] 입구|출구
 */
const HIGHWAY = /^(오른쪽|왼쪽|전방) ((?:도시)?고속도로) (입구|출구)$/;

/** N시 방향 단독(138/142 — 회전 어휘 없이 시계 방위만). */
const CLOCK = /^(\d+시 방향)$/;

/**
 * Tmap 표준 문형. [1] 지점(…에서의 앞부분) [2] 방면 [3] 행동 [4] 꼬리(도로+거리).
 * 꼬리를 통째로 보존하는 것이 계약이다 — 도로명 조사·거리 표기를 건드리지 않는다.
 */
// ⚠ 이름 있는 캡처 그룹은 tsconfig target(ES2017)에서 컴파일 오류다 — 인덱스 그룹만 쓴다.
const FRAME = new RegExp(
  String.raw`^(?:(.+?)에서 )?(?:(.+?) 방면으로 )?(.+?) 후 (.+?(?:을|를) 따라 \d+(?:\.\d+)?k?m 이동)$`,
);

/** 행동 어절 → 동사구. 매핑이 없으면 null(원문 보존 신호). */
function mapAction(action: string): string | null {
  const direct = ACTION_MAP[action];
  if (direct) return direct;
  const hw = HIGHWAY.exec(action);
  if (hw) {
    const suffix = hw[3] === "입구" ? "입구로 들어선 뒤" : "출구로 나온 뒤";
    return `${hw[1]} ${hw[2]} ${suffix}`;
  }
  const clock = CLOCK.exec(action);
  if (clock) return `${clock[1]}으로 진행한 뒤`;
  return null;
}

/** 안내문 한 줄 재작성. 규칙에 걸리지 않으면 원문 그대로 돌려준다. */
export function rewriteCarGuidance(description: string): string {
  const m = FRAME.exec(description);
  if (!m) return description;
  const [, at, toward, action, tail] = m;
  if (KEEP.test(action)) return description;
  const mapped = mapAction(action);
  if (!mapped) return description;

  // 지점명이 시설어로 끝나면 흡수한다("남산1호터널에서 터널을 지나"의 중복 제거).
  // "지나" 계열에만 성립한다 — "들어선 뒤" 계열은 시설이 아니라 갈래가 목적어다.
  // 방면이 있으면 흡수하지 않는다(방면은 지점이 아니라 진행 방향을 수식한다).
  if (at && !toward && mapped.endsWith("지나") && at.endsWith(action)) {
    const particle = objectParticle(at);
    if (particle) return `${at}${particle} 지나 ${tail}`;
  }

  return [at && `${at}에서`, toward && `${toward} 방면으로`, mapped, tail]
    .filter(Boolean)
    .join(" ");
}

/** 브리핑 전체 재작성. guidance 외 필드(기하·수치)는 그대로 보존한다. */
export function rewriteCarBriefing(briefing: CarRouteBriefing): CarRouteBriefing {
  return {
    ...briefing,
    guides: briefing.guides.map((g) => ({
      ...g,
      guidance: rewriteCarGuidance(g.guidance),
    })),
  };
}
