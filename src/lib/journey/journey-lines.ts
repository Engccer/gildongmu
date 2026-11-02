/**
 * 여정 결과 화면 문장(E70-f 웹 입구, spec `2026-11-02-e70-web-journey-design.md` §5·§6) — 순수 함수, React 비의존.
 * iOS `JourneyResultRows.swift`의 문장 조립과 Kit `Journey.swift`의 제목 판정(`journeyVariantHeading`·
 * `journeyLineQualifiers`·`journeyNeedsLineQualifier`·`journeyRecommendedTitleIsBoardSide`·`journeyLineLabel`)을 옮겼다.
 * 노선 비교는 서버 같은 역 판정과 같은 `sameLine`을 쓴다(Kit `journeySameLine`이 그 미러다).
 *
 * 문장 키는 `journey` 네임스페이스(messages) — ko 문장은 iOS `ios.journey.*`와 같다(가드 `journey-web-copy.test.ts`).
 */
import { haversineMeters } from "../geo";
import type { CarRouteBriefing, EgressOption, JourneyResult, JourneyVariant, Place, TransitLeg } from "../types";
import { displayStationName } from "./display";
import { busStopKey, JOURNEY_STATION_IDENTITY_M, sameLine } from "./station-identity";

/** 사용자가 칸에 고른 갈아탈 곳. `kind: "stop"`이면 버스 정류장(E70-e), 없으면 역. */
export interface JourneyStationPick {
  label: string;
  lat: number;
  lng: number;
  line?: string;
  kind?: "stop";
}

/** `journey` 네임스페이스 번역기(next-intl `useTranslations("journey")`). */
export type JourneyT = (key: string, args?: Record<string, string | number>) => string;

const vehicles = (v: JourneyVariant): TransitLeg[] => v.transit.legs.filter((l) => l.mode !== "walk");

/** 대중교통 구간이 버스 정류장에서 시작한다 — 택시 앞 줄·도착 문장이 「역」을 붙이지 않는다(판정 23). */
export function boardsAtBusStop(v: JourneyVariant): boolean {
  return vehicles(v)[0]?.mode === "bus";
}

/** 대중교통 구간이 버스 정류장에서 끝난다. */
export function alightsAtBusStop(v: JourneyVariant): boolean {
  const vs = vehicles(v);
  return vs[vs.length - 1]?.mode === "bus";
}

/**
 * 제목 머리에 붙일 노선 이름(「2호선」·「경의중앙선」, Kit `journeyLineLabel`). 공백·탭·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거.
 * 빈 값은 null.
 */
export function journeyLineLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = [...raw].filter((c) => c !== " " && c !== "." && c !== "\t").join("");
  if (s.startsWith("수도권")) s = s.slice(3);
  if (s.endsWith("(급행)")) s = s.slice(0, -4);
  return s === "" ? null : s;
}

interface StopIdentity {
  name: string;
  line?: string;
  lat: number;
  lng: number;
}

/**
 * 지정 역과 실제로 타는(내리는) 역의 제목에 노선을 붙이는가(판정 26, Kit `journeyNeedsLineQualifier`): 표시 이름이 같고 다른 역일
 * 때만. 노선을 둘 다 알면 노선이 다를 때, 하나라도 모르면 좌표가 같은 역 반경보다 멀 때.
 */
export function journeyNeedsLineQualifier(designated: StopIdentity, actual: StopIdentity): boolean {
  if (displayStationName(designated.name) !== displayStationName(actual.name)) return false;
  if (designated.line && actual.line && journeyLineLabel(designated.line) && journeyLineLabel(actual.line)) {
    return !sameLine(designated.line, actual.line);
  }
  return haversineMeters(designated.lat, designated.lng, actual.lat, actual.lng) > JOURNEY_STATION_IDENTITY_M;
}

/** 문장의 `{station}` 자리 이름에 노선 머리말을 붙인다(「2호선 신촌」). 노선을 모르면 표시 이름만. */
export function journeyQualifiedStationName(name: string, line: string | undefined): string {
  const display = displayStationName(name);
  const label = journeyLineLabel(line);
  return label ? `${label} ${display}` : display;
}

export interface JourneyLineQualifiers {
  board: boolean;
  alight: boolean;
}

/** 추천 변형의 그 쪽 지하철 정류가 칸에 고른 역과 이름은 같고 다른 역인가(Kit `journeyLineQualifiers`). */
export function journeyLineQualifiers(
  result: JourneyResult,
  board: JourneyStationPick | null,
  alight: JourneyStationPick | null,
): JourneyLineQualifiers {
  const out: JourneyLineQualifiers = { board: false, alight: false };
  const recommended = result.variants.find((v) => v.kind === "recommended");
  if (!recommended) return out;
  const vs = vehicles(recommended);
  const stop = (
    leg: TransitLeg | undefined,
    from: boolean,
    ref: { coord: { lat: number; lng: number } } | undefined,
  ): StopIdentity | null => {
    if (!leg || leg.mode === "bus") return null;
    const name = from ? leg.fromName : leg.toName;
    if (!name) return null;
    const s = from ? leg.stops?.[0] : leg.stops?.[leg.stops.length - 1];
    const lat = s?.lat ?? ref?.coord.lat;
    const lng = s?.lng ?? ref?.coord.lng;
    if (lat == null || lng == null) return null;
    return { name, ...(leg.lineName ? { line: leg.lineName } : {}), lat, lng };
  };
  const chosen = (p: JourneyStationPick): StopIdentity => ({
    name: p.label,
    ...(p.line ? { line: p.line } : {}),
    lat: p.lat,
    lng: p.lng,
  });
  if (board && board.kind !== "stop") {
    const actual = stop(vs[0], true, recommended.boardStation);
    if (actual) out.board = journeyNeedsLineQualifier(chosen(board), actual);
  }
  if (alight && alight.kind !== "stop") {
    const actual = stop(vs[vs.length - 1], false, recommended.alightStation);
    if (actual) out.alight = journeyNeedsLineQualifier(chosen(alight), actual);
  }
  return out;
}

/**
 * 추천 변형 제목이 승차 쪽을 말하는가(Kit `journeyRecommendedTitleIsBoardSide`): 승차 쪽이 지정과 다르거나(이름, 또는 동명 이역)
 * 하차 쪽도 같을 때. 아니면(하차 쪽만 다르면) 하차 쪽 제목이다.
 */
export function journeyRecommendedTitleIsBoardSide(
  v: JourneyVariant,
  board: JourneyStationPick | null,
  alight: JourneyStationPick | null,
  lines: JourneyLineQualifiers,
): boolean {
  const vs = vehicles(v);
  const differs = (p: JourneyStationPick, actual: string | undefined) =>
    p.kind === "stop"
      ? busStopKey(p.label) !== busStopKey(actual ?? "")
      : displayStationName(p.label) !== displayStationName(actual ?? "");
  const boardDiffers = board ? differs(board, vs[0]?.fromName) : false;
  const alightDiffers = alight ? differs(alight, vs[vs.length - 1]?.toName) : false;
  return boardDiffers || lines.board || !(alightDiffers || lines.alight);
}

/** 변형 제목(iOS `journeyVariantHeading`, 원 spec §8.4 표 + 조합 규칙). [안내 시작] 버튼 라벨도 이 이름을 쓴다. */
export function journeyVariantHeading(
  v: JourneyVariant,
  board: JourneyStationPick | null,
  alight: JourneyStationPick | null,
  lines: JourneyLineQualifiers,
  t: JourneyT,
): string {
  const vs = vehicles(v);
  const first = vs[0];
  const last = vs[vs.length - 1];
  const named = (name: string, line: string | undefined, qualified: boolean) =>
    qualified ? journeyQualifiedStationName(name, line) : displayStationName(name);
  if (v.kind === "designated") {
    // 지정 경로가 버스로 시작·끝나면 정류장 문장이다(역을 골랐어도 그 이름의 정류장 경로가 잡히면 무엇이 잡혔는지 들린다).
    if (board && first?.mode === "bus") return t("designatedHeadingBus", { stop: first.fromName ?? board.label });
    if (!board && last?.mode === "bus") {
      return t("designatedHeadingBusAlight", { stop: last.toName ?? alight?.label ?? "" });
    }
    if (board) {
      return t("designatedHeading", {
        station: named(first?.fromName ?? board.label, first?.lineName ?? board.line, lines.board),
      });
    }
    return t("designatedHeadingAlight", {
      station: named(last?.toName ?? alight?.label ?? "", last?.lineName ?? alight?.line, lines.alight),
    });
  }
  if (journeyRecommendedTitleIsBoardSide(v, board, alight, lines)) {
    const name = first?.fromName ?? "";
    return first?.mode === "bus"
      ? t("recommendedHeadingBus", { stop: name })
      : t("recommendedHeading", { station: named(name, first?.lineName, lines.board) });
  }
  const name = last?.toName ?? "";
  return last?.mode === "bus"
    ? t("recommendedHeadingBusAlight", { stop: name })
    : t("recommendedHeadingAlight", { station: named(name, last?.lineName, lines.alight) });
}

/** 판정 14: 지정 역 경로를 못 찾았다는 사실 줄(양쪽이면 두 줄). 동명 이역이면 고른 역의 노선을 붙인다(판정 26). */
export function journeyMissingLines(
  result: JourneyResult,
  board: JourneyStationPick | null,
  alight: JourneyStationPick | null,
  t: JourneyT,
): string[] {
  const side = result.designatedMissing?.side;
  if (!side) return [];
  const lines = journeyLineQualifiers(result, board, alight);
  const boardLine = board
    ? board.kind === "stop"
      ? t("designatedMissingStop", { stop: board.label })
      : t("designatedMissing", {
          station: lines.board ? journeyQualifiedStationName(board.label, board.line) : displayStationName(board.label),
        })
    : null;
  const alightLine = alight
    ? alight.kind === "stop"
      ? t("designatedMissingStopAlight", { stop: alight.label })
      : t("designatedMissingAlight", {
          station: lines.alight ? journeyQualifiedStationName(alight.label, alight.line) : displayStationName(alight.label),
        })
    : null;
  const picked = side === "board" ? [boardLine] : side === "alight" ? [alightLine] : [boardLine, alightLine];
  return picked.filter((l): l is string => l !== null);
}

const minutesOf = (b: CarRouteBriefing) => Math.round(b.durationSeconds / 60);
const won = (n: number) => n.toLocaleString("ko-KR");

/** 고른 출구(없으면 기본) — 인덱스가 범위를 넘으면 마지막으로 접는다(iOS `egress`). */
export function journeyEgressOption(v: JourneyVariant, egressIndex: number): EgressOption | null {
  const options = v.egress?.options ?? [];
  if (options.length === 0) return null;
  return options[Math.min(Math.max(egressIndex, 0), options.length - 1)];
}

/** 합계 줄 — 서버 `totals`는 기본 출구 기준이라, 다른 출구·승강장을 고르면 그 택시 구간만큼 바꿔 말한다. */
export function journeyTotalsLine(v: JourneyVariant, egressIndex: number, t: JourneyT): string {
  let minutes = v.totals.minutes;
  let taxiFare = v.totals.taxiFare;
  const base = v.egress?.options[0];
  const picked = journeyEgressOption(v, egressIndex);
  if (base && picked) {
    minutes += minutesOf(picked.taxiOut) - minutesOf(base.taxiOut);
    taxiFare += picked.taxiOut.taxiFare - base.taxiOut.taxiFare;
  }
  return t("totals", { minutes, taxiFare: won(taxiFare), transitFare: won(v.totals.transitFare) });
}

/** 택시 앞 줄. 승차 지정이 없으면 null. 추천이 버스로 시작하면 정류장 이름에 「역」을 붙이지 않는다(판정 23). */
export function journeyTaxiInLine(v: JourneyVariant, t: JourneyT): string | null {
  if (!v.taxiIn || !v.boardStation) return null;
  const args = { minutes: minutesOf(v.taxiIn), fare: won(v.taxiIn.taxiFare) };
  return boardsAtBusStop(v)
    ? t("taxiInStop", { stop: v.boardStation.name, ...args })
    : t("taxiIn", { station: displayStationName(v.boardStation.name), ...args });
}

/** 출구·승강장 줄(3-state: 출구·승강장 / 없음 / 카카오 조회 실패). */
export function journeyEgressLine(v: JourneyVariant, option: EgressOption, t: JourneyT): string {
  const args = { minutes: minutesOf(option.taxiOut), fare: won(option.taxiOut.taxiFare) };
  switch (option.kind) {
    case "exit":
      return t("egressExit", { exit: option.label, ...args });
    case "stand":
      return t("egressStand", args);
    case "none":
      // 버스로 끝나는 변형은 출구 조회를 하지 않아 실패 갈래가 없다(판정 23 대칭).
      if (alightsAtBusStop(v)) return t("egressNoneStop", args);
      return v.egress?.lookupFailed ? t("egressLookupFailed", args) : t("egressNone", args);
  }
}

/**
 * 역 칸의 노선 힌트(원 spec §4.1, iOS `journeyLineHint`): 카카오 분류 끝 조각이 노선이면 그것, 아니면 이름 뒤 공백 다음 노선 토큰
 * (`아현역 2호선`의 `2호선`). 모르면 undefined(서버는 좌표 조건만으로 판정한다).
 */
export function journeyLineHint(place: Pick<Place, "name" | "category">): string | undefined {
  const isLine = (token: string) => token.endsWith("선") || token.endsWith("철도") || token.startsWith("GTX");
  const last = place.category.split(">").pop()?.trim();
  if (last && last !== "지하철,전철" && isLine(last)) return last;
  const tokens = place.name.split(" ").filter((s) => s !== "");
  const tail = tokens.length > 1 ? tokens[tokens.length - 1] : undefined;
  return tail && isLine(tail) ? tail : undefined;
}

/** 최근 경로 줄의 여정 문장(판정 20, iOS `recentJourneyLabel`). 갈아탈 곳이 없으면 null. 정류장은 원문 그대로 말한다. */
export function recentJourneyLabel(
  board: JourneyStationPick | null,
  alight: JourneyStationPick | null,
  from: string,
  to: string,
  t: JourneyT,
): string | null {
  const sides = [board, alight].filter((s): s is JourneyStationPick => s !== null);
  if (sides.length === 0) return null;
  const name = (s: JourneyStationPick) => (s.kind === "stop" ? s.label : displayStationName(s.label));
  if (sides.some((s) => s.kind === "stop")) {
    if (sides.length === 1) return t("recentRouteStop", { from, to, stop: sides[0].label });
    const place = (s: JourneyStationPick) => (s.kind === "stop" ? s.label : t("stationPlace", { station: name(s) }));
    return t("recentRouteBothPlaces", { from, to, board: place(board!), alight: place(alight!) });
  }
  if (board && alight) return t("recentRouteBoth", { from, to, board: name(board), alight: name(alight) });
  return t("recentRoute", { from, to, station: name(sides[0]) });
}
