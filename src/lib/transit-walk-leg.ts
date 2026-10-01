import { bilingualName } from "./bilingual-name";
import { formatDistance, hasHangul } from "./format";
import { boardExitAfterWalk } from "./transit-exit-lines";
import { nonBlank, transitLegUsesEnglish } from "./transit-leg-english";
import type { TransitLeg } from "./types";

/**
 * 대중교통 도보 구간 한 줄의 문구 키와 값 — 화면 브리핑(`TransitRouteResult`)과 WebMCP 도구 출력
 * (`DirectionsView`의 계획 투영)이 같은 함수를 지난다(사람 문장은 화면과 같은 함수에서 나온다).
 * Kit `TransitWalkLegText`·안드로이드 :kit 동형.
 */

/**
 * 마지막 도보(행선지 없음) 줄이 실을 목적지 이름(A52). provider가 이름을 주지 않아 소비자가 아는
 * 목적지 라벨을 쓰는데, 영어 줄이면 **라틴 표기만** 싣는다 — 한 줄 안에서 언어를 섞지 않는다(E27).
 * 라틴 표기는 E28 `bilingualName`의 1순위 이름(로마자·원천 병기·원래 라틴 이름)이고, 그래도 한글이면
 * null이라 "목적지까지" 문구로 떨어진다. 병기 괄호는 붙이지 않는다(이름 뒤에 거리가 이어진다).
 * `english`는 그 줄의 영어 자격(`transitLegUsesEnglish`)이다. 규칙표는 공유 fixture
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
 * 도보 줄의 키·값. 영어 자격은 그 줄 단위(`transitLegUsesEnglish`, Kit `transitLegLine` 동형)다 — 행선지가 있는데
 * 영문 행선지가 없으면 그 줄의 이름은 한국어 원문이고(같은 화면의 탑승 줄도 같은 역을 한국어로 부른다), 문장 틀은
 * UI 언어 그대로다. 행선지는 다음 탑승의 승차역, 없으면 목적지(영어 줄이면 라틴 표기만, A52), 그것도 없으면
 * "목적지까지". 거리는 3-state라 필드가 없으면 거리 없는 문구다. 다음 구간의 승차 출구(E25)는 행선지 이름이 있을
 * 때만 이 줄이 싣는다. 반환 `english`는 이 줄의 이름이 영문인가다(화면이 한국어 이름에 `lang="ko"`를 다는 근거).
 *
 * 화면 브리핑과 WebMCP 계획 투영은 같은 인자로 이 함수를 부른다 — `english`는 데이터 언어(`prefersEnglish`),
 * 목적지는 끝점 라벨과 그 라틴 표기(`labelRoman`, A53)다.
 */
export function transitWalkLegMessage(
  legs: TransitLeg[],
  index: number,
  {
    english,
    destinationLabel,
    destinationRoman,
  }: { english: boolean; destinationLabel: string | null; destinationRoman: string | null },
): {
  key: TransitWalkLegKey;
  values: { minutes: number; name?: string; distance?: string; exit?: string };
  english: boolean;
} {
  const leg = legs[index];
  const lineEnglish = transitLegUsesEnglish(leg, english);
  const name =
    (lineEnglish ? nonBlank(leg.toNameEn) : null) ??
    nonBlank(leg.toName) ??
    transitWalkDestinationName(destinationLabel, destinationRoman, lineEnglish);
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
    english: lineEnglish,
  };
}
