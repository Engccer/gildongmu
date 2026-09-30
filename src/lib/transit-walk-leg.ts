import { bilingualName } from "./bilingual-name";
import { formatDistance, hasHangul } from "./format";
import { boardExitAfterWalk } from "./transit-exit-lines";
import type { TransitLeg } from "./types";

/**
 * 대중교통 도보 구간 한 줄의 문구 키와 값 — 화면 브리핑(`TransitRouteResult`)과 WebMCP 도구 출력
 * (`DirectionsView`의 계획 투영)이 같은 함수를 지난다(사람 문장은 화면과 같은 함수에서 나온다).
 * Kit `TransitWalkLegText`·안드로이드 :kit 동형.
 */

function nonBlank(value: string | null | undefined): string | null {
  return value != null && value.trim() !== "" ? value : null;
}

/**
 * 마지막 도보(행선지 없음) 줄이 실을 목적지 이름(A52). provider가 이름을 주지 않아 소비자가 아는
 * 목적지 라벨을 쓰는데, 영어 줄이면 **라틴 표기만** 싣는다 — 한 줄 안에서 언어를 섞지 않는다(E27).
 * 라틴 표기는 E28 `bilingualName`의 1순위 이름(로마자·원천 병기·원래 라틴 이름)이고, 그래도 한글이면
 * null이라 "목적지까지" 문구로 떨어진다. 병기 괄호는 붙이지 않는다(이름 뒤에 거리가 이어진다).
 * `english`는 호출부가 기존 영어 자격 판정으로 정한 값이다. 규칙표는 공유 fixture
 * `__tests__/fixtures/transit-walk-destination-cases.json`.
 */
export function transitWalkDestinationName(
  label: string | null | undefined,
  roman: string | null | undefined,
  english: boolean,
): string | null {
  const name = nonBlank(label);
  if (name === null || !english) return name;
  const primary = bilingualName("en", name, { roman }).primary;
  return hasHangul(primary) ? null : nonBlank(primary);
}

export type TransitWalkLegKey =
  | "legWalkTo"
  | "legWalkToNoDistance"
  | "legWalkToExit"
  | "legWalkToExitNoDistance"
  | "legWalkToDest"
  | "legWalkToDestNoDistance";

/**
 * 도보 줄의 키·값. 행선지는 다음 탑승의 승차역(`stationNamesEn`이면 서버 영문 `toNameEn`), 없으면 호출부가
 * `transitWalkDestinationName`으로 고른 목적지, 그것도 없으면 "목적지까지". 거리는 3-state라 필드가 없으면
 * 거리 없는 문구다. 다음 구간의 승차 출구(E25)는 행선지 이름이 있을 때만 이 줄이 싣는다.
 *
 * `stationNamesEn`은 **같은 화면의 탑승 줄이 역을 부르는 언어**다 — 도보 줄이 "Yeouido"라 하고 다음 탑승 줄이
 * "여의도"라 하면 같은 역이 두 이름이 된다. ⚠ 웹의 영어 여부는 로케일 단위라, 행선지 영문이 없는 중간 도보는
 * 영어 문장에 한글 역명이 선다(Kit `transitLegUsesEnglish`는 그 줄을 통째로 한국어로 둔다. 기존 차이).
 */
export function transitWalkLegMessage(
  legs: TransitLeg[],
  index: number,
  { stationNamesEn, destination }: { stationNamesEn: boolean; destination: string | null },
): { key: TransitWalkLegKey; values: { minutes: number; name?: string; distance?: string; exit?: string } } {
  const leg = legs[index];
  const name =
    (stationNamesEn ? nonBlank(leg.toNameEn) : null) ?? nonBlank(leg.toName) ?? nonBlank(destination);
  const distance = leg.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
  const exit = name ? boardExitAfterWalk(legs, index) : null;
  const key: TransitWalkLegKey = name
    ? exit
      ? distance
        ? "legWalkToExit"
        : "legWalkToExitNoDistance"
      : distance
        ? "legWalkTo"
        : "legWalkToNoDistance"
    : distance
      ? "legWalkToDest"
      : "legWalkToDestNoDistance";
  return {
    key,
    values: {
      minutes: leg.minutes,
      ...(name ? { name } : {}),
      ...(distance ? { distance } : {}),
      ...(exit ? { exit } : {}),
    },
  };
}
