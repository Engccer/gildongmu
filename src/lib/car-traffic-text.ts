import { formatDistance, hasHangul } from "./format";
import type { CarCongestion, CarJam } from "./types";

/**
 * 정체 문장(E80 spec §4·§5). 화면(웹 `CarRouteResult`)과 주행 중 통지(`useRouteGuide`)가 같은 함수를 지난다.
 * iOS는 같은 키로 `RouteBriefing.swift`·`BeaconModel`이 조립한다(키가 문장 정본).
 *
 * - 비-ko 화면(`english`)은 한글 도로 이름을 뺀다(E61 `carSpokenLandmark`와 같은 규칙 — 외국어 틀에 한글 이름 금지).
 * - 출발 지점에서 바로 시작하는 정체(`JAM_FROM_START_M` 미만)는 「0m 가서」 대신 「출발 지점부터」.
 * - 거리는 `formatDistance`만 지난다.
 */

/** 브리핑에 이름을 부르는 정체 수 상한 — 나머지는 개수만. */
export const BRIEFING_JAM_MAX = 3;
/** 이보다 가까이 시작하는 정체는 "출발 지점부터"로 말한다(m). */
export const JAM_FROM_START_M = 100;

type Translate = (key: string, values?: Record<string, string | number>) => string;

function spokenRoad(road: string | null, english: boolean): string | null {
  return road && !(english && hasHangul(road)) ? road : null;
}

function jamItem(jam: CarJam, t: Translate, english: boolean): string {
  const road = spokenRoad(jam.road, english);
  const length = formatDistance(jam.lengthMeters);
  if (jam.startMeters < JAM_FROM_START_M) {
    return road ? t("jamItemStart", { road, length }) : t("jamItemStartUnnamed", { length });
  }
  const distance = formatDistance(jam.startMeters);
  return road ? t("jamItem", { distance, road, length }) : t("jamItemUnnamed", { distance, length });
}

/**
 * 출발 전 브리핑 한 줄(`route.briefing` 키). undefined(미요청)·null(정보 없음)은 줄 없음 — 정체 없음은
 * 「막히는 구간이 없습니다.」로 정보 없음과 가른다(3-state).
 */
export function carCongestionLine(
  congestion: CarCongestion | null | undefined,
  t: Translate,
  english: boolean,
): string | null {
  if (!congestion) return null;
  const { jams } = congestion;
  if (jams.length === 0) return t("jamNone");
  const named = jams.slice(0, BRIEFING_JAM_MAX).map((j) => jamItem(j, t, english));
  const rest = jams.length - named.length;
  const list = [...named, ...(rest > 0 ? [t("jamMore", { count: rest })] : [])].join(", ");
  return t("jams", { count: jams.length, list });
}

/** 주행 중 새 정체 한 문장(`guide` 키). `aheadMeters`는 지금 위치에서 정체 시작까지. */
export function carNewJamLine(jam: CarJam, aheadMeters: number, t: Translate, english: boolean): string {
  const road = spokenRoad(jam.road, english);
  const distance = formatDistance(aheadMeters);
  const length = formatDistance(jam.lengthMeters);
  return road ? t("carNewJam", { distance, road, length }) : t("carNewJamUnnamed", { distance, length });
}
