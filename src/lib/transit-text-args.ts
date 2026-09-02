/**
 * descriptor 위치 인자 → 웹 i18n named 인자 표(E27 잔여 ①, spec 2026-09-01 §3.7).
 *
 * 공유 descriptor는 **ko 문장의 플레이스홀더 등장 순서**로 위치 인자를 낸다(iOS `String(format:)`
 * 계약). 웹 next-intl은 named 인자라 여기서 한 번 옮긴다 — 표가 그 변환의 유일한 자리이고,
 * 완전성(모든 키가 있고 이름 수가 메시지 플레이스홀더 수와 같다)을 테스트가 강제한다.
 */
export const TRANSIT_TEXT_ARG_NAMES: Record<string, readonly string[]> = {
  waitContext: ["stop", "line"],
  waitContextWalk: ["minutes", "stop", "line"],
  boardingContext: ["stop", "line"],
  context: ["line", "stop"],
  messageFrame: ["stop", "message"],
  subwayNextStop: ["stop"],
  subwayArriving: ["stop"],
  subwayAtStop: ["stop"],
  subwayDeparted: ["stop"],
  approachFrame: ["stop", "message"],
  vehicleSelected: ["desc", "stop"],
  selectedVehicle: ["desc"],
  vehiclePassed: ["stop"],
  arrivedAtBoardStop: ["line"],
  boarded: ["line", "stop"],
  boardedCount: ["line", "stop", "count"],
  currentStation: ["station"],
  bound: ["dest"],
  expressCheck: ["stop"],
  expressStopsAt: ["stop"],
  expressSkipsAlight: ["stop"],
  exitBound: ["exit"],
  departed: ["minutes"],
  terminatesEarly: ["dest", "stop"],
  viaBoard: [],
  viaAlight: [],
  viaCurrent: [],
  overviewLeg: ["n", "line", "board", "alight"],
  prewalkStart: ["station", "minutes"],
  prewalkArrived: ["station"],
  prewalkArrivedButton: ["station"],
};

/**
 * 위치 인자를 named로 옮긴다. **인자가 없는 키는 `undefined`를 돌려준다** — next-intl에 빈 객체를
 * 넘기면 값 없는 보간을 시도하고, 테스트 목에서는 "인자 있음"으로 읽혀 조용히 다른 문자열이 된다.
 */
export function namedArgs(
  key: string,
  args: readonly string[],
): Record<string, string> | undefined {
  const names = TRANSIT_TEXT_ARG_NAMES[key];
  if (!names || names.length === 0) return undefined;
  const out: Record<string, string> = {};
  names.forEach((n, i) => {
    out[n] = args[i] ?? "";
  });
  return out;
}
