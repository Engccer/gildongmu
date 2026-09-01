/**
 * 안내 문장 판정(E27 잔여 ①, spec 2026-09-01 §3.7) — 순수, Kit `TransitGuideText.swift` 미러.
 *
 * 어떤 키를 쓰는가, 어떤 인자를 어떤 순서로 넣는가, **이 줄이 ko인가 en인가**를 여기서 정하고
 * 플랫폼은 자기 카탈로그로 조회만 한다(`TransitWalkLegText` 선례). 그래서:
 * - 판정이 웹·iOS 한 표(`transit-guide-text-cases.json`)로 잠긴다.
 * - 앱 타깃에 테스트 레인이 없는 iOS에서도 문장 판정이 검증된다.
 *
 * **입력은 표시 투영(`TransitDisplayLeg`·`TransitDisplayItem`)뿐이다** — 조인 필드가 타입에 없어
 * 노선명·역명이 조회 쿼리로 새어 나갈 경로가 구조적으로 없다(spec §3.5).
 *
 * ⚠ **인자 순서는 ko 문장의 플레이스홀더 등장 순서가 정본**이다(`TransitWalkLegText` 규약).
 * 어순이 다른 로케일은 변환 스크립트가 인덱스를 재배치하므로 호출부는 이 순서 하나만 지킨다.
 */
import type { TransitDisplayItem, TransitDisplayLeg, TransitLabel } from "./transit-display";
import { subwayRidingMessage } from "./transit-guide";

/** 한 조각: i18n 키(+위치 인자) 또는 완성 문장 원문(서버가 준 그대로 병치). */
export type TransitTextPart = { key: string; args: string[] } | { text: string };

/**
 * 한 줄(한 접근성 객체). `parts`가 비면 그 줄은 생략이고, `lang`은 **값의 언어**다
 * (웹 `lang` 속성용 — 발화 채널은 문자열만 쓴다).
 */
export interface TransitTextLine {
  parts: TransitTextPart[];
  lang: "ko" | "en";
}

const OMIT: TransitTextLine = { parts: [], lang: "ko" };

/**
 * 줄 원자성 판정 — 영문 조각이 **전부** 있을 때만 영어 줄이고, 하나라도 없으면 줄 전체가
 * 한국어 값이다(웹 `pickLine`·Kit `TransitDisplay.pickLine`과 같은 의미).
 *
 * ⚠ `TransitLabel.en`의 빈 문자열은 투영 단계에서 이미 걸러졌다 — 유일한 예외인 `message`
 * 슬롯의 `""`는 "ko에도 그 조각이 없다"는 자리 표시라 여기서 완비로 친다(spec §3.4).
 */
export function pickLabels(
  isEn: boolean,
  labels: TransitLabel[],
): { values: string[]; lang: "ko" | "en" } {
  if (!isEn) return { values: labels.map((l) => l.ko), lang: "ko" };
  const en = labels.map((l) => l.en);
  if (en.every((v): v is string => typeof v === "string")) return { values: en, lang: "en" };
  return { values: labels.map((l) => l.ko), lang: "ko" };
}

/** 라벨 하나 + 라벨 아닌 인자들로 한 줄을 만든다(인자 순서는 ko 문장 순서). */
function line(
  isEn: boolean,
  key: string,
  labels: TransitLabel[],
  build: (values: string[]) => string[],
): TransitTextLine {
  const { values, lang } = pickLabels(isEn, labels);
  return { parts: [{ key, args: build(values) }], lang };
}

// === 문맥 문장 ===

/**
 * 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
 *
 * ⚠ `isCurrentLeg`에 기본값을 두지 않는다 — 다음 구간 안내가 이전 구간에서 고른 역을 말하면
 * 안 되는데, 생략이 통과하면 그 결함이 조용히 들어온다.
 * ⚠ 재선택한 역이 있으면 선행 도보 문구를 붙이지 않는다 — 그 도보는 원래 승차역까지의 구간이라
 * 재선택 뒤에는 이미 지난 일이고, 역명만 바꾸면 "3분 걸어 왕십리역에서"라는 새 거짓말이 된다.
 */
export function waitContextLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  isCurrentLeg: boolean,
): TransitTextLine {
  const overridden = isCurrentLeg && leg.boardOverridden;
  const walk = leg.walkBeforeMinutes;
  if (!overridden && walk != null && walk > 0) {
    return line(isEn, "waitContextWalk", [leg.board, leg.line], ([stop, lineName]) => [
      String(walk),
      stop,
      lineName,
    ]);
  }
  return line(isEn, "waitContext", [leg.board, leg.line], (v) => v);
}

/** boarding 문맥(N3) — 승차 정류소에서 선택 차량을 기다리는 중. */
export function boardingContextLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  return line(isEn, "boardingContext", [leg.board, leg.line], (v) => v);
}

/** 노선·하차 전문 문맥(§6.1 M1) — 추적 시작·진행 상황·상시 표시가 담당. */
export function contextLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  return line(isEn, "context", [leg.line, leg.alight], (v) => v);
}

// === 완성 문장 프레임 ===

/**
 * 승차 국면 상태 문장(§12.3). 버스는 완성 문장의 라벨 프레임("{stop}까지 {message}", 원문 무변형).
 * 지하철은 `arvlMsg2`가 조회역(=하차역) 기준 열차 위치 서술이라 그 틀에 넣으면 뜻이 뒤집힌다
 * ("충정로까지 전역 도착", A27) — `arrivalCode`로 탑승자 시점 문장을 고르고, 99는 생략(잔여 수가
 * 말한다), 미지 코드는 원문을 틀 없이 그대로.
 *
 * ⚠ `arrivalCode` 인자에 기본값 없음(A27 계약 그대로).
 */
export function frameLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  message: TransitLabel,
  arrivalCode: string | null,
): TransitTextLine {
  if (leg.mode === "subway") {
    const r = subwayRidingKey(arrivalCode);
    if (r === "omit") return OMIT;
    if (r) return line(isEn, r, [leg.alight], (v) => v);
    // 미지 코드 — 완성 문장 원문 병치(틀 없이).
    const { values, lang } = pickLabels(isEn, [message]);
    return values[0] ? { parts: [{ text: values[0] }], lang } : OMIT;
  }
  return line(isEn, "messageFrame", [leg.alight, message], (v) => v);
}

/** boarding 완성 문장 프레임 — 승차 정류소 라벨 전치("{stop}에 {message}"). */
export function approachFrameLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  message: TransitLabel,
): TransitTextLine {
  return line(isEn, "approachFrame", [leg.board, message], (v) => v);
}

/**
 * A27 승차 국면 지하철 문장 종류 — **판정은 `subwayRidingMessage`가 정본**이고 여기서는 그 결과를
 * i18n 키로 옮기기만 한다.
 *
 * ⚠ 판정을 여기에 다시 쓰면 안 된다(리뷰 검출 2026-09-01): 그러면 CLAUDE.md가 정본이라 부르는
 * 함수의 프로덕션 호출자가 0이 되어 공유 fixture만 초록인 채로 남고, `arvlCd`를 하나 더해도
 * 실제 문장은 안 따라오는 조용한 드리프트 경로가 생긴다.
 */
function subwayRidingKey(code: string | null): string | "omit" | null {
  const r = subwayRidingMessage(code);
  if (r.kind === "omit") return "omit";
  if (r.kind === "key") return r.key;
  return null;
}

// === 이벤트 통지 ===

/** 차량 선택 응답 — 설명이 없으면 노선명이 그 자리를 대신한다. */
export function vehicleSelectedLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  desc: TransitLabel | null,
): TransitTextLine {
  return line(isEn, "vehicleSelected", [desc ?? leg.line, leg.board], (v) => v);
}

export function selectedVehicleLine(isEn: boolean, desc: TransitLabel): TransitTextLine {
  return line(isEn, "selectedVehicle", [desc], (v) => v);
}

export function vehiclePassedLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  return line(isEn, "vehiclePassed", [leg.board], (v) => v);
}

export function arrivedAtBoardStopLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  return line(isEn, "arrivedAtBoardStop", [leg.line], (v) => v);
}

/** 탑승 통지 — 정거장 수를 아는 경우와 아닌 경우로 키가 갈린다. */
export function boardedLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  if (leg.stationCount != null) {
    const count = leg.stationCount;
    return line(isEn, "boardedCount", [leg.line, leg.alight], ([l, s]) => [l, s, String(count)]);
  }
  return line(isEn, "boarded", [leg.line, leg.alight], (v) => v);
}

export function currentStationLine(isEn: boolean, location: TransitLabel): TransitTextLine {
  return line(isEn, "currentStation", [location], (v) => v);
}

// === 대기 후보 목록(패널) ===

/**
 * 후보 한 줄의 조각들 — 행선·방향·완성 문장·급행 주석·관측 시각. 줄 원자성은 **줄 단위**라
 * 조각 하나라도 영문이 없으면 줄 전체가 한국어다(조각별로 섞지 않는다).
 *
 * ⚠ 조각 순서가 곧 낭독 순서다. 빈 조각은 제거되어 `joinText` 쉼표가 겹치지 않는다.
 */
export function candidateDescLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  item: TransitDisplayItem,
  opts: { express: boolean; departedMinutes: number | null },
): TransitTextLine {
  const labels: TransitLabel[] = [];
  if (item.destination) labels.push(item.destination);
  labels.push(item.direction, item.message);
  if (opts.express) labels.push(leg.alight);
  const { values, lang } = pickLabels(isEn, labels);
  let i = 0;
  const parts: TransitTextPart[] = [];
  if (item.destination) parts.push({ key: "bound", args: [values[i++]] });
  const direction = values[i++];
  if (direction) parts.push({ text: direction });
  const message = values[i++];
  if (message) parts.push({ text: message });
  if (opts.express) parts.push({ key: "expressCheck", args: [values[i++]] });
  if (opts.departedMinutes != null) {
    parts.push({ key: "departed", args: [String(opts.departedMinutes)] });
  }
  return { parts, lang };
}

/**
 * 선택한 차량의 **안정 조각만**으로 만든 설명(행선·방향) — 완성 문장은 폴마다 바뀌므로 넣지 않는다.
 * 선택 시점에 얼려 두는 값이라 `TransitLabel` 한 쌍으로 만들어 두고(ko·en) 이후 렌더가 고른다.
 */
export function vehicleDescLine(isEn: boolean, item: TransitDisplayItem): TransitTextLine {
  const labels: TransitLabel[] = [];
  if (item.destination) labels.push(item.destination);
  labels.push(item.direction);
  const { values, lang } = pickLabels(isEn, labels);
  let i = 0;
  const parts: TransitTextPart[] = [];
  if (item.destination) parts.push({ key: "bound", args: [values[i++]] });
  const direction = values[i];
  if (direction) parts.push({ text: direction });
  return { parts, lang };
}

/** 종착이 하차역보다 앞인 후보의 주석. */
export function terminatesEarlyLine(
  isEn: boolean,
  leg: TransitDisplayLeg,
  item: TransitDisplayItem,
): TransitTextLine {
  const dest = item.destination ?? { ko: "" };
  return line(isEn, "terminatesEarly", [dest, leg.alight], (v) => v);
}

// === 경유 목록·조망 ===

/** 경유 정류소 한 줄 — 이름 + 승차·하차·현재 위치 표식(표식은 UI 라벨이라 인자가 없다). */
export function viaStopLine(
  isEn: boolean,
  stop: TransitLabel,
  role: "board" | "via" | "alight",
  here: boolean,
): TransitTextLine {
  const { values, lang } = pickLabels(isEn, [stop]);
  const parts: TransitTextPart[] = [{ text: values[0] }];
  if (role === "board") parts.push({ key: "viaBoard", args: [] });
  else if (role === "alight") parts.push({ key: "viaAlight", args: [] });
  if (here) parts.push({ key: "viaCurrent", args: [] });
  return { parts, lang };
}

/** 조망의 구간 행 — "{n}. {line}, {board}에서 {alight}까지". */
export function overviewLegLine(
  isEn: boolean,
  n: number,
  line_: TransitLabel,
  board: TransitLabel,
  alight: TransitLabel,
): TransitTextLine {
  return line(isEn, "overviewLeg", [line_, board, alight], ([l, b, a]) => [String(n), l, b, a]);
}

// === 승차 전 도보(A25) ===

export function prewalkStartLine(
  isEn: boolean,
  station: TransitLabel,
  minutes: number,
): TransitTextLine {
  return line(isEn, "prewalkStart", [station], ([s]) => [s, String(minutes)]);
}

export function prewalkArrivedLine(isEn: boolean, station: TransitLabel): TransitTextLine {
  return line(isEn, "prewalkArrived", [station], (v) => v);
}

export function prewalkArrivedButtonLine(isEn: boolean, station: TransitLabel): TransitTextLine {
  return line(isEn, "prewalkArrivedButton", [station], (v) => v);
}

/** descriptor가 낼 수 있는 전체 키(iOS 리터럴 switch 망라성 대조 축, spec §5.2). */
export const TRANSIT_TEXT_KEYS = [
  "waitContext",
  "waitContextWalk",
  "boardingContext",
  "context",
  "messageFrame",
  "subwayNextStop",
  "subwayArriving",
  "subwayAtStop",
  "subwayDeparted",
  "approachFrame",
  "vehicleSelected",
  "selectedVehicle",
  "vehiclePassed",
  "arrivedAtBoardStop",
  "boarded",
  "boardedCount",
  "currentStation",
  "bound",
  "expressCheck",
  "departed",
  "terminatesEarly",
  "viaBoard",
  "viaAlight",
  "viaCurrent",
  "overviewLeg",
  "prewalkStart",
  "prewalkArrived",
  "prewalkArrivedButton",
] as const;
