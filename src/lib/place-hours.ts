import { haversineMeters } from "./geo";

/**
 * 장소 영업시간(E24) 순수 판정 계층 — Google Places 응답을 "오늘 한 줄"로 줄인다.
 * spec `docs/superpowers/specs/2026-08-30-place-hours-google-design.md`.
 *
 * 두 판정이 산다: ①카카오 장소 ↔ 구글 후보 매칭(B1'·B2) ②periods → 오늘(KST) 구간.
 * 둘 다 네트워크 무관 순수 함수라 fixture로 못 박는다. provider(`providers/google-places.ts`)는
 * 전송만 맡는다.
 */

export type HoursRange = { open: string; close: string; closesNextDay: boolean };

export type PlaceHoursToday = {
  /** 오늘 영업 구간(HH:MM). 빈 배열 = 오늘 휴무(다른 요일은 시간표가 있다). */
  ranges: HoursRange[];
  /** 24시간 영업. 이때 ranges는 빈 배열. */
  allDay: boolean;
};

/** Google Places(New) opening hours period — day 0=일요일. 24시간은 close 부재. */
export type GooglePeriod = {
  open: { day: number; hour: number; minute: number; date?: GoogleDate };
  close?: { day: number; hour: number; minute: number; date?: GoogleDate };
};
export type GoogleDate = { year: number; month: number; day: number };
export type GoogleOpeningHours = { periods?: GooglePeriod[] };

export type GoogleCandidate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  formattedAddress?: string;
};

export type MatchTarget = { name: string; lat: number; lng: number; roadAddress?: string };

const MATCH_RADIUS_METERS = 50;

/** 공백·괄호·구두점 제거 소문자 — B1 완전 일치용. */
export function normalizeHoursName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s\-·_,.&'"]/g, "")
    .toLowerCase();
}

/** 주소의 행정구역 낱말(시·구·군·동·읍·면·리, 접미 제거)을 브랜드 코어 잡음 토큰으로 유도. */
export function regionTokensFromAddress(address: string | undefined): string[] {
  if (!address) return [];
  const out = new Set<string>();
  for (const tok of address.split(/\s+/)) {
    const m = /^([가-힣]{1,6})(특별시|광역시|특별자치시|특별자치도|시|도|구|군|동|읍|면|리)$/.exec(tok);
    if (m && m[1].length >= 2) out.add(m[1]);
  }
  return [...out];
}

/**
 * 브랜드 코어 — 지점 접미·지역 토큰·후행 숫자를 반복 제거(「페리카나 풍납점」↔「페리카나치킨 풍납2점」
 * 실측 케이스). 지역 토큰은 상수 목록이 아니라 그 장소의 주소에서 유도한다.
 */
export function brandCore(name: string, regionTokens: string[]): string {
  let s = normalizeHoursName(name);
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/(직영점|본점|지점|점)$/u, "");
    // 지역 토큰은 접두·접미 위치에서만 뗀다 — 중간까지 지우면 「강동이발소」·「이발소」가 같은 코어가 된다
    for (const t of regionTokens) {
      if (s.startsWith(t)) s = s.slice(t.length);
      if (s.endsWith(t)) s = s.slice(0, -t.length);
    }
    s = s.replace(/\d+$/, "");
  }
  return s;
}

const ROAD_KEY_RE = /([가-힣A-Za-z0-9]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/;

/** 도로명 주소 키 `(도로명, 건물번호)` — 대형 시설의 좌표 이격(≤1km)을 이름+주소로 구제. */
export function roadKey(address: string | undefined): string | null {
  const m = ROAD_KEY_RE.exec(address ?? "");
  return m ? `${m[1]}|${m[2]}` : null;
}

/**
 * 후보 중 매칭 1건. B1' = 이름 완전 일치 AND (≤50m OR 도로명 키 일치), B2 = 브랜드 코어 일치 AND ≤50m.
 * 좌표만으로는 매칭하지 않는다(B3 기각 — 옆 가게 영업시간을 붙인다).
 */
export function matchGoogleCandidate(
  target: MatchTarget,
  candidates: GoogleCandidate[],
): GoogleCandidate | null {
  const targetName = normalizeHoursName(target.name);
  const targetRoad = roadKey(target.roadAddress);
  const tokens = regionTokensFromAddress(target.roadAddress);
  const targetCore = brandCore(target.name, tokens);
  let b2: GoogleCandidate | null = null;
  for (const c of candidates) {
    const dist = haversineMeters(target.lat, target.lng, c.lat, c.lng);
    const near = dist <= MATCH_RADIUS_METERS;
    if (normalizeHoursName(c.name) === targetName) {
      if (near) return c;
      if (targetRoad && roadKey(c.formattedAddress) === targetRoad) return c;
      continue;
    }
    if (!b2 && near && targetCore.length >= 2 && brandCore(c.name, tokens) === targetCore) b2 = c;
  }
  return b2;
}

/** KST 달력 날짜·요일(0=일). 서버 TZ에 의존하지 않는다. */
export function kstToday(nowMs: number): { date: GoogleDate; weekday: number } {
  const d = new Date(nowMs + 9 * 3600 * 1000);
  return {
    date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    weekday: d.getUTCDay(),
  };
}

function hhmm(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

function sameDate(a: GoogleDate | undefined, b: GoogleDate): boolean {
  return !!a && a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * 오늘 구간. `current`(날짜 붙은 7일치, 공휴일 반영)를 우선하고 없으면 `regular`(요일)로.
 * 둘 다 periods가 없으면 null(정보 없음 — 줄을 만들지 않는다). 24시간은 close 없는 period.
 */
export function todayHours(
  current: GoogleOpeningHours | undefined,
  regular: GoogleOpeningHours | undefined,
  nowMs: number,
): PlaceHoursToday | null {
  const { date, weekday } = kstToday(nowMs);
  const cur = current?.periods;
  const reg = regular?.periods;
  let periods: GooglePeriod[];
  let isToday: (p: GooglePeriod) => boolean;
  if (cur && cur.length > 0 && cur.some((p) => p.open.date)) {
    periods = cur;
    isToday = (p) => sameDate(p.open.date, date);
  } else if (reg && reg.length > 0) {
    periods = reg;
    isToday = (p) => p.open.day === weekday;
  } else {
    return null;
  }
  if (periods.some((p) => !p.close && p.open.hour === 0 && p.open.minute === 0)) {
    return { ranges: [], allDay: true };
  }
  const ranges = periods
    .filter(isToday)
    .filter((p): p is Required<GooglePeriod> => !!p.close)
    .map((p) => ({
      open: hhmm(p.open),
      close: hhmm(p.close),
      closesNextDay: p.close.day !== p.open.day,
    }))
    .sort((a, b) => a.open.localeCompare(b.open));
  return { ranges, allDay: false };
}
