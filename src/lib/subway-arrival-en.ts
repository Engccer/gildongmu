/**
 * 서울 지하철 실시간 도착의 영문 투영(E27 §3.4, 순수 — seed 조회는 `ctx`로 주입).
 *
 * `lang=en` 응답에만 실린다. 원칙: **거짓 문장보다 부재**. 코드×문장 정확 행렬(설계 리뷰 #4),
 * 수치 범위(#7), 역명 모호·모순(#5·#6)은 전부 필드 부재로 떨어지고 소비자가 한국어 원문으로
 * 폴백한다. `barvlDt`(초)는 쓰지 않는다(운행종료에도 비0 — CLAUDE.md 함정).
 *
 * 관측 근거(2026-08-31 강남·천호·홍대입구·서울역 실호출)는 spec §2.2 표.
 */
import { lineHintMatches, parseStationQuery } from "./station-match";
import { subwayLineNameEn } from "./subway-line-names";
import type { SubwayArrival, SubwayStation } from "./types";

export interface ArrivalEnContext {
  /** 역명(한국어, 괄호 부가명 허용) → seed 후보. 라우트가 `findStationsByName` 바인딩을 넘긴다. */
  findStations: (query: string, lineHint?: string) => SubwayStation[];
}

const DIRECTION_EN: Record<string, string> = {
  상행: "Up",
  하행: "Down",
  내선: "Inner Circle",
  외선: "Outer Circle",
};

/**
 * seed 영문 역명(설계 리뷰 #6). 도착 노선과 `lineHintMatches`하는 후보를 **우선**하고 — 1호선 열차의
 * 종착 `동두천`은 seed `경원선` 행이라 노선 필터를 강제할 수 없다 — 남은 후보의 영문 집합이 둘
 * 이상이면 null(추측 금지). 괄호 노선 힌트(`신촌(경의중앙선)`)는 여기서 직접 뽑아 seed 매칭에 쓴다.
 */
export function stationNameEn(
  ctx: ArrivalEnContext,
  name: string,
  lineKo: string | undefined,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // 괄호 노선 힌트(`신촌(경의중앙선)`)는 후행 토큰이 아니라 `parseStationQuery`가 못 본다 — 직접 뽑는다.
  const paren = /\(([^)]+)\)/.exec(trimmed)?.[1];
  const parenHint = paren && /(선|철도)$|^GTX/i.test(paren) ? paren : undefined;
  const lineHint = parenHint ?? parseStationQuery(trimmed).lineHint;
  const all = ctx.findStations(trimmed, lineHint);
  if (all.length === 0) return null;
  // 같은 노선 판정은 두 겹: 영문 표 동치(`공항철도` ↔ seed `인천국제공항선`이 둘 다 AREX — 실호출 서울역
  // 게이트 검출 2026-08-31) → 코어 접두 일치(`lineHintMatches`).
  const lineEn = lineKo ? subwayLineNameEn(lineKo) : null;
  const sameLine = lineKo
    ? all.filter(
        (s) =>
          (lineEn != null && subwayLineNameEn(s.lineName) === lineEn) || lineHintMatches(s.lineName, lineKo),
      )
    : [];
  const pool = sameLine.length > 0 ? sameLine : all;
  // 표기 차이(`Seoul Station`/`Seoul station`)는 같은 이름 — 대소문자 무시로 모은다.
  const byKey = new Map<string, string>();
  for (const s of pool) {
    const en = s.nameEn.trim();
    if (en) byKey.set(en.toLowerCase(), byKey.get(en.toLowerCase()) ?? en);
  }
  if (byKey.size !== 1) return null;
  return [...byKey.values()][0];
}

const TRAIN_LINE_RE = /^(.+?)행 - (.+?)방면(?: \(급행\))?$/;
const STATION_EVENT_RE = /^(.+?) (진입|도착|출발)$/;
const MINUTES_RE = /^(\d+)분(?: (\d+)초)? 후(?: \((.+)\))?$/;
const STOPS_AWAY_RE = /^\[(\d+)\]번째 전역(?: \((.+)\))?$/;

const warnedShapes = new Set<string>();
function warnShape(code: string, shape: string) {
  const key = `${code}|${shape}`;
  if (warnedShapes.has(key)) return;
  warnedShapes.add(key);
  // 역명은 빼고 모양만 남긴다(설계 리뷰 #17 — 실시간 문구 drift를 조용한 강등 대신 로그로).
  console.warn(`[subway-arrival-en] 행렬 밖 도착 문장: code=${code} shape=${shape}`);
}

const SHAPE_KEYWORDS = new Set(["진입", "도착", "출발", "전역", "후", "분", "초", "번째"]);
/** 문장 모양(계측용) — 숫자는 N, 행렬 낱말 밖의 한글은 S(역명이 로그에 남지 않게). */
function shapeOf(message: string): string {
  return message
    .replace(/\d+/g, "N")
    .replace(/[가-힣]+/g, (w) => (SHAPE_KEYWORDS.has(w) ? w : "S"));
}

interface MessageEn {
  messageEn?: string;
  /** 99 문장의 괄호 현재역(한국어) — `currentLocationEn` 후보 */
  parenStation?: string;
}

/**
 * `arvlCd`×`arvlMsg2` 정확 행렬. 코드가 아니라 **문장이 정본**이고 어긋남은 미지 변형이라 부재.
 * 괄호 현재역은 문장에 넣지 않는다(설계 리뷰 #5 — `currentLocationEn` 단일 채널).
 */
export function arrivalMessageEn(
  ctx: ArrivalEnContext,
  code: string | undefined,
  message: string,
  lineKo: string | undefined,
): MessageEn {
  const msg = message.trim();
  if (!code || !msg) return {};
  switch (code) {
    case "0":
    case "1":
    case "2": {
      const m = STATION_EVENT_RE.exec(msg);
      const verb = code === "0" ? "진입" : code === "1" ? "도착" : "출발";
      if (!m || m[2] !== verb) {
        warnShape(code, shapeOf(msg));
        return {};
      }
      const station = stationNameEn(ctx, m[1], lineKo);
      if (!station) return {};
      const en = code === "0" ? `Approaching ${station}` : code === "1" ? `Arrived at ${station}` : `Departed ${station}`;
      return { messageEn: en };
    }
    case "3":
      if (msg !== "전역 출발") return warnAndEmpty(code, msg);
      return { messageEn: "Departed previous station" };
    case "4":
      if (msg !== "전역 진입") return warnAndEmpty(code, msg);
      return { messageEn: "Approaching previous station" };
    case "5":
      if (msg !== "전역 도착") return warnAndEmpty(code, msg);
      return { messageEn: "Arrived at previous station" };
    case "99": {
      const t = MINUTES_RE.exec(msg);
      if (t) {
        const minutes = Number(t[1]);
        const seconds = t[2] == null ? null : Number(t[2]);
        if (minutes < 1 || (seconds != null && (seconds < 0 || seconds > 59))) return {};
        const en = seconds == null || seconds === 0 ? `In ${minutes} min` : `In ${minutes} min ${seconds} sec`;
        return { messageEn: en, ...(t[3] ? { parenStation: t[3] } : {}) };
      }
      const k = STOPS_AWAY_RE.exec(msg);
      if (k) {
        const stops = Number(k[1]);
        if (stops < 1) return {};
        const en = stops === 1 ? "1 station away" : `${stops} stations away`;
        return { messageEn: en, ...(k[2] ? { parenStation: k[2] } : {}) };
      }
      return warnAndEmpty(code, msg);
    }
    default:
      return warnAndEmpty(code, msg);
  }
}

function warnAndEmpty(code: string, msg: string): MessageEn {
  warnShape(code, shapeOf(msg));
  return {};
}

/** `{종착}행 - {방면}방면` → `To {Dest} via {Via}`. 둘 다 seed 영문이 있을 때만. */
export function trainLineNmEn(
  ctx: ArrivalEnContext,
  trainLineNm: string,
  lineKo: string | undefined,
): string | undefined {
  const m = TRAIN_LINE_RE.exec(trainLineNm.trim());
  if (!m) return undefined;
  const dest = stationNameEn(ctx, m[1], lineKo);
  const via = stationNameEn(ctx, m[2], lineKo);
  if (!dest || !via) return undefined;
  return `To ${dest} via ${via}`;
}

/**
 * 도착 한 건에 영문 필드를 더한다(각 필드 독립 — 줄 단위 원자성은 소비자 `pickLine`이 든다).
 * `currentLocationEn`은 arvlMsg3 우선, 없으면 99 문장의 괄호 역명. 둘 다 있고 정규화 역명이
 * 다르면 부재(모순은 침묵).
 */
export function enrichArrivalEn(arrival: SubwayArrival, ctx: ArrivalEnContext): SubwayArrival {
  const lineKo = arrival.line;
  const lineEn = subwayLineNameEn(lineKo) ?? undefined;
  const directionEn = DIRECTION_EN[arrival.direction.trim()];
  const trainEn = trainLineNmEn(ctx, arrival.trainLineNm, lineKo);
  const { messageEn, parenStation } = arrivalMessageEn(ctx, arrival.arrivalCode, arrival.message, lineKo);

  let currentLocationEn: string | undefined;
  const fromMsg3 = arrival.currentLocation?.trim();
  if (fromMsg3 && parenStation && normalizeKey(fromMsg3) !== normalizeKey(parenStation)) {
    currentLocationEn = undefined; // 모순
  } else {
    const source = fromMsg3 || parenStation;
    currentLocationEn = source ? (stationNameEn(ctx, source, lineKo) ?? undefined) : undefined;
  }

  return {
    ...arrival,
    ...(lineEn ? { lineEn } : {}),
    ...(directionEn ? { directionEn } : {}),
    ...(trainEn ? { trainLineNmEn: trainEn } : {}),
    ...(messageEn ? { messageEn } : {}),
    ...(currentLocationEn ? { currentLocationEn } : {}),
  };
}

function normalizeKey(name: string): string {
  return parseStationQuery(name).nameKey;
}
