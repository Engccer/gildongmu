import type { TransitLeg, TransitRoute } from "../types";

/**
 * 여정에서 택시가 대신하는 앞뒤 도보를 대중교통 경로에서 뗀다(D3, 순수).
 *
 * - `trimBoard`: 첫 탈것 앞의 도보 leg들, `trimAlight`: 마지막 탈것 뒤의 도보 leg들. 탈것 사이 도보(환승)는 자르지 않는다.
 * - 합계는 **원래 합계에서 뗀 도보 분만** 뺀다(0 하한). 남은 legs로 다시 더하지 않는다 — ODsay 정규화가 거리 0인
 *   역내 환승 통로를 legs에서 빼고 그 시간을 `summary`에만 남기므로 다시 더하면 통로 시간이 사라진다.
 * - `walkMeters`는 뗀 leg가 전부 거리를 알 때만 뺀다. 하나라도 모르면 키를 지운다(모름을 틀린 값으로 남기지 않는다).
 * - 택시가 대신하는 쪽 끝 탈것의 ODsay 출구 번호(`exit.board`/`exit.alight`)는 뗀다(여정의 출구는 `egress`가 정한다).
 * - `routeKey`·`fare`·`transfers`·`highlight`는 유지. 입력은 변형하지 않는다.
 */
export function trimJourneyTransit(
  route: TransitRoute,
  opts: { trimBoard: boolean; trimAlight: boolean },
): TransitRoute {
  const first = route.legs.findIndex((l) => l.mode !== "walk");
  if (first < 0) return { ...route, summary: { ...route.summary }, legs: [...route.legs] };
  let last = route.legs.length - 1;
  while (route.legs[last].mode === "walk") last--;

  const start = opts.trimBoard ? first : 0;
  const end = opts.trimAlight ? last + 1 : route.legs.length;
  const removed: TransitLeg[] = [
    ...route.legs.slice(0, start),
    ...route.legs.slice(end),
  ];
  // ODsay 출구 번호(`exit`)는 ODsay가 조회 출발·도착 좌표(= 지정 역 좌표)로 고른 출구라 여정에선 뜻이 없다 —
  // 택시가 대신하는 쪽의 번호를 남기면 하차 줄 「7번 출구 방면」과 출구 선택 줄 「1번 출구로 나가 …」가 다른 출구를 말한다.
  const legs = route.legs.slice(start, end).map((l, i, arr) => {
    const dropBoard = opts.trimBoard && i === 0 && l.exit?.board !== undefined;
    const dropAlight = opts.trimAlight && i === arr.length - 1 && l.exit?.alight !== undefined;
    if (!dropBoard && !dropAlight) return l;
    const exit = { ...l.exit };
    if (dropBoard) delete exit.board;
    if (dropAlight) delete exit.alight;
    const rest: TransitLeg = { ...l };
    delete rest.exit;
    return exit.board !== undefined || exit.alight !== undefined ? { ...rest, exit } : rest;
  });
  const summary = { ...route.summary };

  if (removed.length > 0) {
    const removedMinutes = removed.reduce((n, l) => n + l.minutes, 0);
    summary.totalMinutes = Math.max(0, summary.totalMinutes - removedMinutes);
    summary.walkMinutes = Math.max(0, summary.walkMinutes - removedMinutes);
    if (summary.walkMeters !== undefined) {
      const known = removed.every((l) => typeof l.distanceMeters === "number" && Number.isFinite(l.distanceMeters));
      if (known) {
        const removedMeters = removed.reduce((n, l) => n + (l.distanceMeters ?? 0), 0);
        summary.walkMeters = Math.max(0, summary.walkMeters - removedMeters);
      } else {
        delete summary.walkMeters;
      }
    }
  }

  if (opts.trimBoard && route.legs[first].fromName !== undefined) summary.departName = route.legs[first].fromName;
  if (opts.trimAlight && route.legs[last].toName !== undefined) summary.arriveName = route.legs[last].toName;

  return { ...route, summary, legs };
}
