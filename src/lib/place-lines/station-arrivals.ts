/**
 * 실시간 도착 열차(`SubwayArrivalList` 컴포넌트) 항목 조립 — 두 줄(편성/메시지)이 화면과 동일.
 *
 * 메시지 줄은 서울시 완성 문장(`arvlMsg2`)을 **읽어 같은 뜻을 우리 문장으로 다시 쓴다**(E37,
 * spec `docs/superpowers/specs/2026-09-13-subway-arrival-prose-design.md`). 못 알아보는 문장은
 * 그 줄만 원문 그대로(+A32 꼬리) — 실패 방향이 현행이라 정보 손실 0.
 *
 * en 계열 로케일은 서버 영문 필드(`*En`, E27)로 줄을 만들되 **줄 단위 원자성**(`pickLine`)을 지킨다 —
 * 편성 줄은 노선·방향·행선 셋이 다 영문일 때만, 문장형 메시지 줄은 UI 언어로 조립하되 역명(`currentLocationEn`)이
 * 필요한데 없으면, 원문 메시지 줄은 문장(+현재역이 있으면 그 영문까지)이 없으면 그 줄 전체가 한국어(`lang: "ko"`)다.
 */
import { prefersEnglish } from "../data-locale";
import { joinText } from "../format";
import type { SubwayArrival } from "../types";
import { pickLine, type LocalizedLine } from "./pick-line";
import type { TranslateFn } from "./translate";

export interface ArrivalItem {
  /** 편성 줄: 노선 방향, 행선 안내, 급행(있을 때) */
  line: string;
  /** 편성 줄 언어 태그(한국어 폴백 `ko`, 비-en 로케일의 영어 줄 `en`, 그 외 없음) */
  lineLang?: "ko" | "en";
  direction: string;
  /** 메시지 줄: 우리 문장(E37) 또는 arvlMsg2 원문 + 현재 위치(있을 때) */
  message: string;
  messageLang?: "ko" | "en";
  /** 도착 항목이 있다는 것 자체가 ok — 역 단위 4-state는 상위 봉투가 든다 */
  state: { kind: "ok" };
}

export type SubwayArrivalVerb = "approaching" | "arrived" | "departed";

/**
 * 완성 문장의 뜻(E37 §2.1) — 웹 ↔ Kit `SubwayArrivalPlan` 미러.
 * `station`은 문장 안에 들어가는 역(관계가 실측으로 확인된 문법만), `nowAt`은 관계를 단정하지 않는
 * `현재 {역}.` 꼬리. 둘이 함께 있는 계획은 없고, 위치를 신뢰할 수 없는 문법은 둘 다 갖지 않는다.
 */
export type SubwayArrivalPlan =
  | { kind: "stationEvent"; verb: SubwayArrivalVerb; station: string }
  | { kind: "prevStationEvent"; verb: SubwayArrivalVerb; station: string }
  | { kind: "departedStopsBack"; count: number }
  | { kind: "stopsAway"; count: number; station: string }
  | { kind: "eta"; minutes?: number; seconds?: number; stops?: number; nowAt?: string };

const VERB: Record<string, SubwayArrivalVerb> = { 진입: "approaching", 도착: "arrived", 출발: "departed" };
const PREV_EVENT_RE = /^전역 (진입|도착|출발)$/;
const PREV_DEPARTED_WITH_STATION_RE = /^(.+?)\s*전역출발$/;
const STATION_EVENT_RE = /^(.+?) (진입|도착|출발)$/;
// ⚠ 괄호는 **필수**다. 코퍼스 254행이 전부 괄호를 다는데, 괄호가 없는 변형이 오면 그 역이 열차
// 위치라는 보장이 없다(`{X} 전역출발`의 X가 조회 역 자신인 것과 같은 계열일 수 있다) — I2가 막으려는
// 실패 모드 그 자체라 원문에 맡긴다(설계 리뷰 MAJOR-2).
const STOPS_AWAY_RE = /^\[(\d+)\]번째 전역\s*\((.+)\)$/;
// 괄호는 소·대괄호 둘 다 온다(`4분 후 (삼각지)` · `3분48초후[3번째 전]`).
// ⚠ 문자 클래스 안의 `[`는 Kit 미러(ICU)가 중첩 집합으로 읽으므로 양쪽 다 이스케이프한다.
const ETA_RE = /^(?:(\d+)분)?(?:\s*(\d+)초)?\s*후(?:\s*[(\[](.+)[)\]])?$/;
/** 구 문법 `3분 후(2번째 전)`의 괄호 — 역명이 아니라 잔여 정거장이다. */
const ETA_STOPS_PAREN_RE = /^\[?(\d+)\]?번째 전$/;

/**
 * 문장에서 읽은 역과 `arvlMsg3`를 하나로 — **둘 다 있고 다르면 모순**이라 `undefined`가 아니라 실패다.
 * 서버 `enrichArrivalEn`의 "둘이 다르면 부재"와 같은 축(그래야 §3.1의 `currentLocationEn`이 이 역의 영문이다).
 */
function resolveStation(fromText: string | undefined, fromMsg3: string): { ok: true; station?: string } | { ok: false } {
  const text = fromText?.trim() || undefined;
  if (text && fromMsg3 && text !== fromMsg3) return { ok: false };
  return { ok: true, station: text || fromMsg3 || undefined };
}

/**
 * 서울시 완성 문장 → 우리 문장 계획(E37). 순수. Kit `subwayArrivalProse` 미러 — 공유 fixture
 * `src/lib/__tests__/fixtures/subway-arrival-prose-cases.json`이 두 구현을 한 표로 잠근다.
 *
 * ⚠ 불변식 I1: 게이트는 **문장의 모양**이고 초 수도 문장에서 읽는다. `barvlDt`(`arrivalSeconds`)·`arvlCd`
 * (`arrivalCode`)는 판정에도 값에도 쓰지 않는다 — 비시간형 행에도 `barvlDt`가 비0으로 오고(코퍼스 65행,
 * 심야 `전역 출발`에 1200초), `[N]번째 전역`이 코드 1로도 온다(8호선 심야 24행).
 * ⚠ 불변식 I2: 역명을 싣는 것은 그 역이 열차 위치임이 실측으로 확인된 문법뿐이다(`전역 …` = 1정거장 전,
 * `[N]번째 전역 (X)` = N정거장 전, `N분 후 (X)`). `{X} 전역출발`의 X는 조회 역 자신이고(12/12)
 * `전전역 출발`은 관측이 얇아 `arvlMsg3`의 뜻을 모른다 — 이 둘은 역명을 문장에도 꼬리에도 싣지 않는다.
 * 못 알아보면 `null`(원문 경로) — 역을 지어내지 않는다(3-state).
 */
export function subwayArrivalProse(
  message: string | undefined | null,
  currentLocation: string | undefined | null,
): SubwayArrivalPlan | null {
  const msg = (message ?? "").trim();
  const msg3 = (currentLocation ?? "").trim();
  if (!msg) return null;

  const prev = PREV_EVENT_RE.exec(msg);
  if (prev) {
    if (!msg3) return null;
    return { kind: "prevStationEvent", verb: VERB[prev[1]], station: msg3 };
  }
  // ⚠ 이 두 문법은 **위치를 말하지 않는다**(I2). `{X} 전역출발`의 X는 조회 역 자신이고(12/12, 문장에
  // 그 이름이 박혀 온다), `전전역 출발`은 관측이 얇아 `arvlMsg3`의 뜻을 모른다(쓸 수 있는 1행에서 한 역
  // 앞을 가리켜 문장의 "두 역 앞"과 어긋났다 — 다른 1행은 20분 묵은 레코드라 근거가 못 된다).
  // 그 역이 열차 위치라는 증거가 없는데 실으면 unknown을 "있음"으로 바꾸는 것이다(위원장 확정 2026-09-13).
  if (msg === "전전역 출발") return { kind: "departedStopsBack", count: 2 };
  const prevDeparted = PREV_DEPARTED_WITH_STATION_RE.exec(msg);
  if (prevDeparted) {
    // 모순(문장의 역 ≠ `arvlMsg3`)은 우리가 모르는 모양이라 원문에 맡긴다 — 값은 쓰지 않지만 판정에는 쓴다.
    if (!resolveStation(prevDeparted[1], msg3).ok) return null;
    return { kind: "departedStopsBack", count: 1 };
  }
  const stops = STOPS_AWAY_RE.exec(msg);
  if (stops) {
    const count = Number(stops[1]);
    if (count < 1) return null;
    const r = resolveStation(stops[2], msg3);
    if (!r.ok || !r.station) return null;
    return { kind: "stopsAway", count, station: r.station };
  }
  const eta = ETA_RE.exec(msg);
  if (eta && (eta[1] != null || eta[2] != null)) {
    const minutes = eta[1] == null ? undefined : Number(eta[1]);
    const seconds = eta[2] == null ? undefined : Number(eta[2]);
    if (seconds != null && seconds > 59) return null;
    const min = minutes ?? 0;
    const sec = seconds ?? 0;
    if (min < 1 && sec < 1) return null;
    // 구 문법 `3분 후(2번째 전)`의 괄호는 역명이 아니라 잔여 정거장이다 — 정거장 조각으로 풀고
    // 현재역은 `arvlMsg3`가 맡는다(위원장 2026-09-13).
    const legacy = eta[3] == null ? null : ETA_STOPS_PAREN_RE.exec(eta[3].trim());
    const stops = legacy ? Number(legacy[1]) : undefined;
    if (stops != null && stops < 1) return null;
    const r = legacy ? { ok: true as const, station: msg3 || undefined } : resolveStation(eta[3], msg3);
    if (!r.ok) return null;
    return {
      kind: "eta",
      ...(min >= 1 ? { minutes: min } : {}),
      ...(sec >= 1 ? { seconds: sec } : {}),
      ...(stops != null ? { stops } : {}),
      ...(r.station ? { nowAt: r.station } : {}),
    };
  }
  // ⚠ 당역 문법은 **`arvlMsg3`와 값이 같을 때만** 인정한다 — `{무엇} 도착` 모양은 역명이 아닌 말도 통과시킨다
  // (`곧 도착`의 "곧"을 역으로 읽는다). 코퍼스의 이 문법 228행은 전부 `arvlMsg3`와 같은 값이라 실측 손실 0이다.
  const event = STATION_EVENT_RE.exec(msg);
  if (event && msg3 && event[1].trim() === msg3) {
    return { kind: "stationEvent", verb: VERB[event[2]], station: msg3 };
  }
  return null;
}

/** 계획이 요구하는 역(문장의 역 또는 꼬리) — 없으면 그 줄은 역명 없이 선다. */
export function planStation(plan: SubwayArrivalPlan): string | undefined {
  switch (plan.kind) {
    case "stationEvent":
    case "prevStationEvent":
    case "stopsAway":
      return plan.station;
    case "departedStopsBack":
      return undefined;
    case "eta":
      return plan.nowAt;
  }
}

const PREV_KEY: Record<SubwayArrivalVerb, string> = {
  approaching: "prevApproaching",
  arrived: "prevArrived",
  departed: "prevDeparted",
};

/** 문장 한 조각 — 키와 인자(순서는 ko 문장의 플레이스홀더 순서, iOS 위치 인자 ABI). */
export interface ArrivalProseSegment {
  key: string;
  args: Array<string | number>;
}

/**
 * 계획 + 그 줄에 실릴 역명 → 문장 조각(E37 §2.2). **키 선택이 여기 한 곳**이라 웹·Kit이 갈리지 않는다
 * (공유 fixture의 `keys` 열이 두 구현을 잠근다 — Kit `subwayArrivalProseSegments` 미러).
 * `joined`는 쉼표로, `tail`은 앞 문장과 공백으로 잇는다(마침표 있는 문장 둘을 잇는 자리).
 */
export function arrivalProseSegments(
  plan: SubwayArrivalPlan,
  station: string | undefined,
): { joined: ArrivalProseSegment[]; tail?: ArrivalProseSegment } {
  const at = station ?? "";
  switch (plan.kind) {
    case "stationEvent":
      return { joined: [{ key: plan.verb, args: [at] }] };
    case "prevStationEvent":
      return { joined: [{ key: PREV_KEY[plan.verb], args: [at] }] };
    case "departedStopsBack":
      return { joined: [{ key: "departedStopsBack", args: [plan.count] }] };
    case "stopsAway":
      return { joined: [{ key: "stopsAway", args: [plan.count, at] }] };
    case "eta": {
      const eta: ArrivalProseSegment =
        plan.minutes != null && plan.seconds != null
          ? { key: "etaMinSec", args: [plan.minutes, plan.seconds] }
          : plan.minutes != null
            ? { key: "etaMin", args: [plan.minutes] }
            : { key: "etaSec", args: [plan.seconds ?? 0] };
      // 정거장이 함께 오면 버스 안내 상태 문장과 같은 순서·구분(정거장 먼저, 쉼표)으로 잇는다(E39 §2.2).
      const joined = plan.stops != null ? [{ key: "stopsJoin", args: [plan.stops] }, eta] : [eta];
      // 꼬리의 유무는 **계획**이 정하고 역명은 표기일 뿐이다 — 호출자가 넘긴 값으로 가르면
      // `nowAt` 없는 계획에 en 줄만 꼬리가 붙는다(설계 리뷰 MINOR-4).
      const tail = plan.nowAt != null ? { key: "nowAt", args: [station ?? plan.nowAt] } : undefined;
      return { joined, ...(tail ? { tail } : {}) };
    }
  }
}

/** 키마다 고정인 인자 이름 — 조각의 인자 순서(= ko 문장의 순서)로 짝짓는다. */
const ARG_NAMES: Record<string, string[]> = {
  approaching: ["station"],
  arrived: ["station"],
  departed: ["station"],
  prevApproaching: ["station"],
  prevArrived: ["station"],
  prevDeparted: ["station"],
  departedStopsBack: ["count"],
  stopsAway: ["count", "station"],
  stopsJoin: ["count"],
  etaMin: ["minutes"],
  etaMinSec: ["minutes", "seconds"],
  etaSec: ["seconds"],
  nowAt: ["station"],
};

function renderSegment(seg: ArrivalProseSegment, t: TranslateFn): string {
  const values: Record<string, string | number> = {};
  (ARG_NAMES[seg.key] ?? []).forEach((name, i) => {
    values[name] = seg.args[i];
  });
  return t(seg.key, values);
}

/** 조각 → 메시지 줄(한 접근성 객체). */
export function renderArrivalProse(plan: SubwayArrivalPlan, station: string | undefined, t: TranslateFn): string {
  const { joined, tail } = arrivalProseSegments(plan, station);
  const body = joinText(...joined.map((seg) => renderSegment(seg, t)));
  return tail ? `${body} ${renderSegment(tail, t)}` : body;
}

/**
 * 도착 한 줄에 현재역 꼬리(`현재 {역}`)를 붙일 것인가(A32) — Kit `subwayShowsCurrentLocationTail` 미러.
 * 공유 fixture `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`이 두 구현을 한 표로 잠근다.
 * E37 뒤로는 **원문 경로**(문장을 못 알아본 줄)에서만 쓰인다.
 *
 * 낭독 정본인 완성 문장(`arvlMsg2`)이 **이미 현재역을 담는 문법이 있다**(`6분 후 (강일)`·`강일 도착`).
 * 그 위에 꼬리를 또 이으면 한 접근성 객체 안에서 같은 역 이름이 두 번 낭독된다.
 *
 * ⚠ **판정 축은 값 포함이지 글자 패턴이 아니다** — 역 이름 자체에 괄호가 있어서
 * (`천호(풍납토성) 전역출발`) "괄호가 있으면 현재역이 들어 있다"는 규칙은 바로 어긋난다.
 * 알아보지 못하면 **붙이는 쪽**으로 실패한다(= 현행 동작, 정보 손실 0).
 *
 * ⚠ **언어마다 자기 값으로 판정한다.** 영문 문장은 괄호 현재역을 담지 않으므로
 * (`subway-arrival-en.ts`가 `currentLocationEn` 단일 채널로 뺀다 — E27 설계 리뷰 #5) 한국어 값으로
 * en을 판정하면 중복이 없는 줄에서 꼬리를 떼어 **en 사용자만 현재역을 잃는다**.
 */
export function subwayShowsCurrentLocationTail(
  message: string | undefined | null,
  currentLocation: string | undefined | null,
): boolean {
  const location = (currentLocation ?? "").trim();
  // 현재역이 애초에 없으면 붙일 것도 없다("정보 없음"이지 중복이 아니다).
  if (!location) return false;
  // 문장은 trim하지 않는다 — 찾는 값의 양끝 공백이 이미 없어 문장 양끝을 다듬어도 포함 여부가
  // 바뀌지 않는데, 두 언어의 trim 문자 집합이 다르다는 발산 표면만 들어온다.
  return !(message ?? "").includes(location);
}

export function arrivalItems(
  arrivals: SubwayArrival[],
  t: TranslateFn,
  locale: string = "ko",
): ArrivalItem[] {
  return arrivals.map((a) => {
    const express = a.express ? t("express") : undefined;
    const lineKo = joinText(`${a.line ? `${a.line} ` : ""}${a.direction}`, a.trainLineNm, express);
    // 노선 미매핑(`line` 부재)은 ko도 방향만 쓴다 — 그 자리는 `""`(자리 표시)라 영문 요구 대상이 아니다
    // (`lineEn`은 `line`이 있을 때만 결측으로 본다). 현재역도 같다.
    const line = pickLine(
      locale,
      lineKo,
      [a.line ? a.lineEn : "", a.directionEn, a.trainLineNmEn],
      ([lineEn, dir, train]) => joinText(`${lineEn ? `${lineEn} ` : ""}${dir}`, train, express),
    );

    const plan = subwayArrivalProse(a.message, a.currentLocation);
    // 문장형(E37)은 UI 언어로 조립하고 역명만 데이터 언어를 따른다. 영문 화면에서 역명이 필요한데
    // `currentLocationEn`이 없으면 **문장형을 포기하고 원문 경로로 떨어진다** — 영어 문장에 한국어
    // 역명을 끼우면 한 줄 안에서 언어가 섞이고(E27), 문장 틀이 UI 번역기 하나라 그 줄만 한국어로
    // 되돌릴 수단이 없기 때문이다. 영문 자리의 결측 판정은 **영문 값 자신**이다(A38).
    const koStation = plan ? planStation(plan) : undefined;
    const useEnglishData = prefersEnglish(locale);
    const proseStation = useEnglishData ? a.currentLocationEn : koStation;
    const proseReady = plan != null && (koStation === undefined || proseStation !== undefined);
    // UI 템플릿 문장이라 언어 태그를 달지 않는다 — ja 화면의 문장은 일본어이고, 역명 한 낱말 때문에
    // 줄에 `lang="en"`을 달면 일본어 문장이 영어 음성으로 낭독된다.
    let message: LocalizedLine;
    if (plan && proseReady) {
      message = { text: renderArrivalProse(plan, proseStation, t) };
    } else {
      // 원문 경로(현행 A32 그대로): 꼬리 판정(A32)은 그 줄에 실제로 쓰는 값으로 한다 — ko는 원문, en은 영문.
      // ⚠ **판정에 먹이는 값이 곧 렌더되는 값이어야 한다.** `enLoc` 한 변수가 꼬리 판정과 `enParts` 양쪽에 간다.
      // A38: 영문 자리의 결측은 **영문 값 자신**으로 가른다 — 있으면 그 값, 없고 ko도 없으면 자리 표시 `""`,
      // 없는데 ko는 있으면 결측(줄 전체 ko). 종전 `a.currentLocation ? a.currentLocationEn : ""`은 ko 칸이
      // 비었다는 이유로 영문 현재역을 버려 en 사용자만 현재역을 잃었다.
      const enLoc = a.currentLocationEn ?? (a.currentLocation ? undefined : "");
      const koTail = subwayShowsCurrentLocationTail(a.message, a.currentLocation);
      const enTail = subwayShowsCurrentLocationTail(a.messageEn, enLoc);
      const messageKo = joinText(
        a.message,
        koTail && a.currentLocation && t("currentLocation", { location: a.currentLocation }),
      );
      message = pickLine(
        locale,
        messageKo,
        [a.messageEn, enLoc],
        ([msg, loc]) => joinText(msg, enTail && t("currentLocation", { location: loc })),
        // 현재역 문장은 UI 템플릿(`Now at {location}`)이라 영어 줄이면 혼합 줄 — en 태그를 달지 않는다.
        // 꼬리를 떼면 그 템플릿이 없으므로 순수 데이터 줄이다.
        { pure: !enTail },
      );
    }
    return {
      line: line.text,
      ...(line.lang ? { lineLang: line.lang } : {}),
      direction: a.direction,
      message: message.text,
      ...(message.lang ? { messageLang: message.lang } : {}),
      state: { kind: "ok" },
    };
  });
}
