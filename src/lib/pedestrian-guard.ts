/**
 * en 문장의 출처는 구조화 필드지만, Tmap 응답에는 **한국어 원문이 여전히 실려 온다**.
 * 그것을 대조 가드로 쓰면 미관측 코드(설계 리뷰 #4)와 Point→LineString 귀속 가정(#5)이
 * 조용히 틀리는 대신 즉시 실패한다. 비용 0 — 이미 받은 데이터다.
 *
 * ⚠ **원문은 출처가 아니라 증인이다.** 여기서 문장을 만들지 않는다(만들면 `walkStepAction`
 * 계열의 한국어 의존이 되살아난다).
 *
 * ⚠ 30경로 435스텝 코퍼스에서 **두 축 모두 오탐 0**(spec §2.4). 가드 자체가 새 실패 모드이므로
 * 그 수치가 이 파일을 켜는 조건이었고, 실호출 게이트가 회귀로 지킨다. 그래서 ko 폴백 경로에는
 * 켜지 않는다(`normalizeTmapWalkRoute`의 `guard` 옵션, 기본 false) — 종전 동작을 흔들지 않는다.
 */

/**
 * 표지 → 허용 turnType 집합. **순서가 곧 불변식이다**(회전 → 시설 → 건널목):
 * "횡단보도"는 지명의 일부로 등장하므로("천호역 횡단보도에서 좌회전 후 …") 건널목을 먼저 보면
 * 좌회전 스텝이 모순으로 잡혀 **정상 경로가 죽는다**. `walk-action.ts`의 MARKERS가 같은 이유로
 * 같은 순서를 쓴다. "좌측"·"우측"은 어느 쪽 횡단보도인지라 회전 표지가 아니다(목록에 없는 이유).
 */
const MARKERS: readonly (readonly [string, readonly number[]])[] = [
  ["유턴", [14]],
  ["좌회전", [12, 16, 17]],
  ["우회전", [13, 18, 19]],
  ["엘리베이터", [218]],
  ["육교", [125]],
  ["지하보도", [126]],
  ["계단", [127, 129]],
  ["경사로", [128, 129]],
  ["횡단보도", [211, 212, 213, 214, 215, 216, 217]],
  ["도착", [201]],
  ["직진", [0, 11, 200, 233]],
];

/** 코드와 한국어 원문 표지가 모순이면 throw. 표지가 없으면 판정하지 않는다. */
export function assertTurnTypeMatchesKorean(turnType: number, description: string): void {
  const hit = MARKERS.find(([marker]) => description.includes(marker));
  if (!hit) return;
  if (hit[1].includes(turnType)) return;
  throw new Error(
    `[pedestrian] turnType ${turnType}이 원문 표지 "${hit[0]}"와 모순: ${description}`,
  );
}

/** 원문 "NNNm 이동"·"N.Nkm 이동"에서 거리를 뽑는다. */
const DISTANCE = /(\d+(?:\.\d+)?)\s*(km|m)\s*이동/;

/**
 * 원문이 말하는 거리와 귀속된 구간 거리가 어긋나면 throw — "Point 뒤 **첫** LineString이 그
 * 스텝의 문장 구간"이라는 귀속 가정의 런타임 증명이다. 초안의 "합" 귀속은 이 가드에서
 * 435스텝 중 48건이 걸려 설계 결함이 설계 단계에서 드러났다.
 */
export function assertDistanceMatchesKorean(
  description: string,
  segmentMeters: number | undefined,
): void {
  if (segmentMeters === undefined) return;
  const m = DISTANCE.exec(description);
  if (!m) return;
  const spoken = m[2] === "km" ? Number(m[1]) * 1000 : Number(m[1]);
  if (Math.abs(spoken - segmentMeters) <= 1) return;
  throw new Error(
    `[pedestrian] 원문 거리 ${spoken}m와 구간 ${segmentMeters}m 불일치(귀속 가정 파손): ${description}`,
  );
}
