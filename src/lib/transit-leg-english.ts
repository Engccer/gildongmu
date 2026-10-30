import type { TransitLeg } from "./types";

/*
 * 대중교통 구간 줄의 언어(E27 줄 단위 원자성) — Kit `transitLegUsesEnglish`(`TransitExitLines.swift`)·
 * 안드로이드 :kit 미러. 화면 브리핑(`TransitRouteResult`)과 WebMCP 계획 투영(`DirectionsView`)이 같은
 * 판정을 지난다(사람 문장은 화면과 같은 함수에서 나온다, A53).
 *
 * 영어 줄은 그 줄이 부르는 이름의 영문이 **전부** 있을 때만이다. 탑승 구간은 노선·승차·하차, 도보는
 * 행선지(행선지가 없는 마지막 도보는 목적지 문구라 영문 조각이 필요 없다). 한국어 쪽에 없는 조각은
 * 영문을 요구하지 않는다. 하나라도 모자라면 그 줄의 이름은 전부 한국어다(문장 틀은 UI 언어 그대로).
 */

/** 빈값·공백값은 정보 부재(Kit `transitBriefingName` 동형). */
export function nonBlank(value: string | null | undefined): string | null {
  return value != null && value.trim() !== "" ? value : null;
}

/** `english`는 데이터 언어가 영어인가(`prefersEnglish(locale)`)다. */
export function transitLegUsesEnglish(leg: TransitLeg, english: boolean): boolean {
  if (!english) return false;
  const present = (ko: string | undefined, en: string | undefined) => nonBlank(ko) === null || nonBlank(en) !== null;
  if (leg.mode === "walk") return present(leg.toName, leg.toNameEn);
  // 노선 집합(E76)은 한 조각으로 읽히므로 모든 노선의 영문이 있어야 영어 줄이다(한 조각 안에서 언어를 섞지 않는다).
  const lanesEn = (leg.lanes ?? []).every((lane) => nonBlank(lane.lineNameEn) !== null);
  return (
    nonBlank(leg.lineNameEn) !== null &&
    lanesEn &&
    present(leg.fromName, leg.fromNameEn) &&
    present(leg.toName, leg.toNameEn)
  );
}

/**
 * 탑승 줄이 부르는 노선 조각(E76). 같은 정류소 쌍을 잇는 노선 집합이 있으면 그 번호 전부를 쉼표로 이은 한 조각
 * (「1711, 1020, 7016」 — 문장 틀은 그대로 「…번 버스」), 없으면 그 leg의 노선 하나.
 */
function lineOf(leg: TransitLeg, en: boolean): string | null {
  if (leg.lanes && leg.lanes.length >= 2) {
    const names = leg.lanes.map((lane) => nonBlank(en ? lane.lineNameEn : lane.lineName));
    if (names.every((n): n is string => n !== null)) return names.join(", ");
  }
  return nonBlank(en ? leg.lineNameEn : leg.lineName);
}

/** 탑승 줄이 부르는 노선·승차·하차 이름 — 영어 줄이면 셋 다 영문, 아니면 셋 다 한국어 원문. 부재는 null. */
export function transitBoardLegNames(
  leg: TransitLeg,
  english: boolean,
): { english: boolean; line: string | null; from: string | null; to: string | null } {
  const en = transitLegUsesEnglish(leg, english);
  return {
    english: en,
    line: lineOf(leg, en),
    from: nonBlank(en ? leg.fromNameEn : leg.fromName),
    to: nonBlank(en ? leg.toNameEn : leg.toName),
  };
}
