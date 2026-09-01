/**
 * 안내 표시 투영(E27 잔여 ①, spec 2026-09-01 §3.5) — 순수, Kit `TransitDisplayProjection.swift` 미러.
 *
 * **조인 필드가 타입에 없다.** 문장을 만드는 계층은 `TransitGuideLeg`·`TrackItem` 원본을 받지 않고
 * 여기서 만든 투영만 받는다 — 그래서 노선명·역명을 조회 쿼리나 매핑표 키로 쓰는 코드가 표시 경로에
 * **존재할 수 없다**(소스 가드는 2선이고 이 타입이 1선이다).
 *
 * 조인은 투영을 거치지 않는 계층(URL 조립·리듀서·`TransitLock`·종착 검사)이 원본에서 직접 읽는다.
 * 두 계층이 같은 값을 각자 읽되 한쪽에는 반대쪽 필드가 존재하지 않는 것이 이 설계의 요지다.
 *
 * ⚠ 투영에 `vehicleId`·`routeId`·`arsId`·좌표를 넣지 말 것 — 넣는 순간 표시 계층이 다시 조인할 수 있다.
 */
import type { TrackItem, TransitGuideLeg } from "./transit-guide";
import type { TransitLegStop } from "./types";

/** 한 조각의 ko·en 쌍. `en` 부재 = 그 조각의 영문이 없다(그 줄은 통째로 ko). */
export interface TransitLabel {
  ko: string;
  en?: string;
}

export interface TransitDisplayLeg {
  mode: "bus" | "subway";
  line: TransitLabel;
  /** 재선택한 기준 역이 있으면 그 역(A16 L3). */
  board: TransitLabel;
  alight: TransitLabel;
  stops: TransitLabel[];
  stationCount: number | null;
  walkBeforeMinutes: number | null;
  /** 승차 지점이 재선택으로 바뀌었는가 — 선행 도보 문구 분기 축(지난 도보를 다시 말하지 않게). */
  boardOverridden: boolean;
}

export interface TransitDisplayItem {
  /** ⚠ 유일하게 `""`가 유효한 조각(TAGO는 ko도 완성 문장이 없다). */
  message: TransitLabel;
  direction: TransitLabel;
  destination: TransitLabel | null;
  currentLocation: TransitLabel | null;
  express: boolean;
  remainingStops: number | null;
  /** 차량 식별자 유무 — 원문 식별자는 표시 계층에 넘기지 않는다. */
  selectable: boolean;
}

/**
 * 조각 정규화 — 두 방향을 함께 본다(spec §3.4 ⚠).
 *
 * ① **영문 자리의 빈 문자열은 영문이 아니다.** 이름·방향·종착역의 `""`는 "비어도 된다"가 아니라
 * 정보 소실이라, 그대로 두면 줄 원자성 판정이 "완비"로 읽어 `Boarded . Get off at .`를 만든다.
 * ② ⚠ **ko가 비어 있으면 그 조각은 언어 축이 아니다.** ko에도 없는 것을 "영문 결측"으로 세면
 * 나머지 조각이 전부 영문이어도 줄 전체가 한국어로 되돌아간다 — 서울버스는 `direction`이
 * 구조적으로 `""`(서버가 `directionEn`을 만들지 않는다)라, 이 정규화가 없으면 서버가 만든
 * `In 6 min 47 sec`가 대기 후보 목록에서 통째로 버려진다(리뷰 2인 독립 검출).
 * CLAUDE.md 계약 그대로다: "`""`는 ko에도 그 조각이 없다는 자리 표시라 영어 줄이 성립한다."
 */
function label(ko: string | undefined, en: string | undefined): TransitLabel {
  const koText = ko ?? "";
  const enText = en?.trim() ? en : undefined;
  if (!koText.trim()) return { ko: koText, en: enText ?? "" };
  return { ko: koText, ...(enText ? { en: enText } : {}) };
}

function stopLabel(stop: TransitLegStop): TransitLabel {
  return label(stop.name, stop.nameEn);
}

/**
 * leg → 표시 투영. `boardOverrideIndex`는 세션 경로 `viaStops`의 인덱스다(이름이 아니다 —
 * 정규화 후 동명 역이 둘이면 이름 역조회가 다른 역의 영문명을 고른다, spec §3.6).
 * 범위 밖 인덱스는 override 없음으로 떨어진다.
 */
export function transitDisplayLeg(
  leg: TransitGuideLeg,
  boardOverrideIndex: number | null,
): TransitDisplayLeg {
  const override =
    boardOverrideIndex != null ? (leg.viaStops[boardOverrideIndex] ?? null) : null;
  return {
    mode: leg.mode,
    line: label(leg.lineName, leg.lineNameEn),
    board: override ? stopLabel(override) : label(leg.boardName, leg.boardNameEn),
    alight: label(leg.alightName, leg.alightNameEn),
    stops: leg.viaStops.map(stopLabel),
    stationCount: leg.stationCount,
    walkBeforeMinutes: leg.walkBeforeMinutes,
    boardOverridden: override !== null,
  };
}

/** 폴링 항목 → 표시 투영. `message`만 `""`를 자리 표시로 보존한다. */
export function transitDisplayItem(item: TrackItem): TransitDisplayItem {
  return {
    message: {
      ko: item.message,
      ...(item.messageEn !== undefined ? { en: item.messageEn } : {}),
    },
    direction: label(item.direction, item.directionEn),
    destination: item.destinationName
      ? label(item.destinationName, item.destinationNameEn)
      : null,
    currentLocation: item.currentLocation
      ? label(item.currentLocation, item.currentLocationEn)
      : null,
    express: item.express,
    remainingStops: item.remainingStops,
    selectable: !!item.vehicleId,
  };
}

/** 이벤트가 실어 온 완성 문장 쌍(같은 관측에서 나온 ko·en, spec §3.4). */
export function messageLabel(ko: string, en: string | undefined): TransitLabel {
  return { ko, ...(en !== undefined ? { en } : {}) };
}

/** 현재역 쌍 — 없으면 null(부재와 빈 문자열을 뭉개지 않는다). */
export function locationLabel(
  ko: string | null | undefined,
  en: string | undefined,
): TransitLabel | null {
  return ko ? label(ko, en) : null;
}
