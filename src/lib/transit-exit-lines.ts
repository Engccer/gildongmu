import { joinText } from "./format";
import { quickExitText } from "./quick-exit-text";
import { validExitNo } from "./transit-guide";
import type { QuickExit, TransitLeg } from "./types";

/**
 * 경로 브리핑의 출구 번호 줄(E25 — 위원장 요청 2026-09-07). Kit `TransitExitLines.swift` 미러.
 *
 * **출구는 한 경로 안에서 정확히 한 줄에만 실린다.** 승차 출구는 직전 도보 줄이 싣고, 그 줄이
 * 없으면(버스에서 바로 갈아타거나 역에서 출발) 탑승 줄 끝이 싣는다 — 판정은 서버 문맥이 아니라
 * **렌더되는 구간 배열의 직전 항목**으로 한다. 0m 도보 leg는 `odsay.ts`가 화면 목록에서 지우므로
 * "서버가 역 밖 진입이라고 했다"와 "붙일 도보 줄이 있다"가 어긋나는데, 화면 구조로 가르면 그
 * 어긋남과 무관하게 겹침·누락이 둘 다 불가능해진다.
 *
 * 하차 출구는 하차 줄 끝이다(문 위치 먼저, 출구가 결론). 빠른하차가 없으면 종전엔 줄 자체가
 * 없었으므로 하차역 이름으로 줄을 세운다.
 */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * 하차 줄 — 빠른하차 문장 뒤에 출구를 잇고, 빠른하차가 없으면 하차역만으로 줄을 세운다.
 *
 * ⚠ 출구 문구는 안내 세션과 **같은 키**(`transitGuide.exitBound`)다. 같은 정보를 두 화면이 다른
 *   낱말로 말하면 사용자가 둘을 같은 것으로 알아보지 못한다. 그래서 네임스페이스가 다른 `t`를
 *   둘 받는다(호출부가 각자의 네임스페이스를 소유한다).
 *
 * 둘 다 없으면 null — "출구 정보 없음" 같은 부재 문구를 만들지 않는다(3-state).
 */
export function alightLineText(
  t: Translate,
  tGuide: Translate,
  station: string,
  quickExit: QuickExit | undefined,
  exitAlight: string | null | undefined,
): string | null {
  const quick = quickExitText(t, station, quickExit);
  // 서버가 형식·문맥을 이미 걸렀지만 소비자 게이트를 이중으로 둔다(spec 2026-09-02 §5.1).
  const exit = validExitNo(exitAlight);
  const bound = exit ? tGuide("exitBound", { exit }) : null;
  if (quick) return joinText(quick, bound);
  if (!bound || !station) return null;
  return joinText(t("alightAt", { station }), bound);
}

/**
 * 이 도보 구간 줄이 실을 승차 출구 — 다음 구간이 탑승이고 승차 출구가 있을 때만.
 * `index`는 도보 구간 자신의 자리다.
 */
export function boardExitAfterWalk(legs: TransitLeg[], index: number): string | null {
  if (legs[index]?.mode !== "walk") return null;
  const next = legs[index + 1];
  if (!next || next.mode === "walk") return null;
  return validExitNo(next.exit?.board);
}

/**
 * 이 탑승 구간 줄 끝이 실을 승차 출구 — 직전이 도보가 **아닐** 때만(도보면 그 줄이 싣는다).
 * `boardExitAfterWalk`와 정확히 배타라, 둘을 함께 쓰면 겹침도 누락도 없다.
 */
export function boardExitOnBoardLine(legs: TransitLeg[], index: number): string | null {
  const leg = legs[index];
  if (!leg || leg.mode === "walk") return null;
  if (legs[index - 1]?.mode === "walk") return null;
  return validExitNo(leg.exit?.board);
}
