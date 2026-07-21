import { env } from "../env";
import { parseStationQuery, lineHintMatches, normalizeStationName } from "../station-match";
import { findStationsByName } from "../subway-stations";
import { fetchIsHoliday } from "./holiday";
import type { StationTimetable, TimetableLine, TimetableDirection, TimetableTrain } from "../types";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 지하철 노선정보(B-3) provider.
 *
 * 2종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유, Base SubwayInfo,
 * 오퍼레이션 첫 글자 대문자, 소문자 get은 "API not found"):
 * - `GetKwrdFndSubwaySttnList`: 역명 키워드 검색(포함검색, 정확매칭은 호출부 책임)
 * - `GetSubwaySttnAcctoSchdulList`: 역·서비스데이별 전체 발차 스케줄
 *
 * 순수 파싱·산출 로직(ensureItemArray 등)과 fetch 통합(fetchStationTimetable)을
 * 한 파일에 담는다. 첫차·막차 산출의 핵심은 "서비스데이" 개념이다: 00~02시대
 * 심야 열차는 달력상 다음 날이지만 운행상으로는 전날 막차의 연장이다. 03:00
 * 미만 depTime을 +24h 보정해 정렬하면 첫차=최소·막차=최대로 정확히 갈린다.
 * 03:00 경계는 국내 도시철도가 공통으로 갖는 운행 공백(대략 01~05시)에
 * 놓인 휴리스틱이며, 실제 임계 시각이 아니라 안전하게 그 공백 안에만
 * 있으면 되는 값이다(스펙 §1-A-1).
 *
 * fetchStationTimetable 결과 판정(3-state 붕괴 방지, 스펙 §2-A 표):
 * 키워드 정확매칭 0건 → null(미커버, 섹션 미노출). 노선·방향 호출 전부
 * 실패 → throw(라우트 502, 무운행으로 위장 금지). 일부만 실패 → 성공분
 * 결과 + partial:true. 전부 성공했는데 유효 행 0 → { lines: [] }.
 */

export const BASE = "http://apis.data.go.kr/1613000/SubwayInfo";
export const PAGE_SIZE = 500;
// 키워드 매칭 노선 수 상한 — 환승역 등에서 노선별 상·하행 조회가 무한 증폭되지
// 않도록 방어(스펙 §2-A). 실서비스 환승역도 이 상한을 넘지 않는다.
const MAX_LINES = 8;
const SERVICE_DAY_BOUNDARY = 30000; // HHMMSS 수치 03:00:00(위 헤더의 서비스데이 경계 휴리스틱)

export function ensureItemArray(raw: unknown): unknown[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (items == null || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item) ? item : [item];
}

export function parseKeywordStations(raw: unknown): Array<{ id: string; name: string; routeName: string }> {
  return ensureItemArray(raw)
    .map((it) => {
      const o = it as Record<string, unknown>;
      return {
        id: o.subwayStationId == null ? "" : String(o.subwayStationId),
        name: o.subwayStationName == null ? "" : String(o.subwayStationName),
        routeName: o.subwayRouteName == null ? "" : String(o.subwayRouteName),
      };
    })
    .filter((s) => s.id && s.name);
}

/** TAGO 축약 노선명("수인분당"·"공항") 표시 규칙. 선 종결 아니면 "선" 부가. 매핑 테이블 금지. */
export function displayLineName(routeName: string): string {
  const t = routeName.trim();
  return /선$/.test(t) ? t : `${t}선`;
}

/** KST-3h 경계의 서비스데이 날짜·요일 타입. 서버 타임존 비의존(UTC 산술 고정). */
export function computeServiceDailyType(nowUtcMs: number): { date: string; type: "weekday" | "saturday" | "sunday" } {
  const kstMinus3h = new Date(nowUtcMs + 9 * 3600_000 - 3 * 3600_000);
  const y = kstMinus3h.getUTCFullYear();
  const m = String(kstMinus3h.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstMinus3h.getUTCDate()).padStart(2, "0");
  const dow = kstMinus3h.getUTCDay(); // 0=일
  const type = dow === 0 ? "sunday" : dow === 6 ? "saturday" : "weekday";
  return { date: `${y}${m}${d}`, type };
}

interface ScheduleRow { subwayStationId?: unknown; endSubwayStationId?: unknown; endSubwayStationNm?: unknown; depTime?: unknown; }

/** 첫차·막차 산출(스펙 §1-A 계약). 서비스데이 정렬·당역종착 제외·행 유효성 가드·익일 판정. */
export function deriveFirstLast(
  rows: unknown[],
  stationId: string,
): { first: { time: string; nextDay?: true; terminus: string }; last: { time: string; nextDay?: true; terminus: string } } | null {
  const candidates = rows.flatMap((r) => {
    const o = r as ScheduleRow;
    const dep = o.depTime == null ? "" : String(o.depTime);
    if (!/^\d{6}$/.test(dep)) return []; // 오염 행 가드
    if (String(o.endSubwayStationId ?? "") === stationId) return []; // 당역 종착(탑승 불가)
    const raw = Number(dep);
    const adjusted = raw < SERVICE_DAY_BOUNDARY ? raw + 240000 : raw;
    const train = {
      time: `${dep.slice(0, 2)}:${dep.slice(2, 4)}`,
      ...(raw < SERVICE_DAY_BOUNDARY ? { nextDay: true as const } : {}),
      terminus: o.endSubwayStationNm == null ? "" : String(o.endSubwayStationNm),
    };
    return [{ adjusted, train }];
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.adjusted - b.adjusted);
  return { first: candidates[0].train, last: candidates[candidates.length - 1].train };
}

/** TAGO 오퍼레이션 공통 호출: envelope resultCode·totalCount 검증까지 담당. */
async function fetchTago(op: string, params: Record<string, string>): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const search = new URLSearchParams({
    serviceKey: key, _type: "json", numOfRows: String(PAGE_SIZE), pageNo: "1", ...params,
  });
  const res = await fetch(`${BASE}/${op}?${search}`, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`TAGO ${op} HTTP ${res.status}`);
  const raw: unknown = await res.json();
  const header = (raw as { response?: { header?: { resultCode?: unknown } } })?.response?.header;
  const code = String(header?.resultCode ?? "");
  // 00 정상. NODATA류가 별코드(03)로 오면 통과(빈 items 처리) — 그 외는 throw.
  if (code !== "00" && code !== "03") throw new Error(`TAGO ${op} resultCode ${code}`);
  const total = Number((raw as { response?: { body?: { totalCount?: unknown } } })?.response?.body?.totalCount ?? 0);
  if (total > PAGE_SIZE) throw new Error(`TAGO ${op} totalCount(${total}) > ${PAGE_SIZE} — 페이지 누락`);
  return raw;
}

/** 행선지 영문 병기 — seed 미매칭이면 한글 그대로(정직 폴백, 스펙 §7-17). */
function withTerminusEn(t: { time: string; nextDay?: true; terminus: string }): TimetableTrain {
  const en = findStationsByName(t.terminus)[0]?.nameEn;
  return en ? { ...t, terminusEn: en } : t;
}

/**
 * 역명으로 첫차·막차 시간표를 조회한다(전국, 스펙 §2-A 판정 표).
 *
 * 1. 키워드 검색 → 정확매칭 + lineHint 필터(동명이역 오합병 방지) → 노선별
 *    subwayStationId 목록(상한 MAX_LINES). 0건이면 미커버 → null.
 * 2. serviceDate(KST-3h) 요일 타입을 공휴일 여부로 보정(판정 불가면 요일 폴백).
 * 3. 노선×상하행 병렬 조회 — 전부 실패는 throw(무운행으로 위장 금지),
 *    일부 실패는 성공분 + partial:true.
 */
export async function fetchStationTimetable(stationName: string): Promise<StationTimetable | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const { nameKey, lineHint } = parseStationQuery(stationName);
  if (!nameKey) return null;
  const keywordRaw = await fetchTago("GetKwrdFndSubwaySttnList", { subwayStationName: nameKey });
  const matched = parseKeywordStations(keywordRaw)
    .filter((s) => normalizeStationName(s.name) === nameKey)
    .filter((s) => !lineHint || lineHintMatches(s.routeName, lineHint))
    .slice(0, MAX_LINES);
  if (matched.length === 0) return null; // 미커버 — 섹션 미노출

  const service = computeServiceDailyType(Date.now());
  const holiday = await fetchIsHoliday(service.date); // null=판정 불가 → 요일 폴백
  const dailyType = holiday === true ? "sunday" : service.type;
  const dailyTypeCode = dailyType === "weekday" ? "01" : dailyType === "saturday" ? "02" : "03";

  const jobs = matched.flatMap((st) => (["U", "D"] as const).map((dir) => ({ st, dir })));
  const settled = await Promise.allSettled(
    jobs.map(({ st, dir }) =>
      fetchTago("GetSubwaySttnAcctoSchdulList", {
        subwayStationId: st.id, dailyTypeCode, upDownTypeCode: dir,
      }),
    ),
  );
  const failures = settled.filter((r) => r.status === "rejected").length;
  if (failures === settled.length) {
    // 전 호출 실패 — "운행 없음"으로 위장 금지(스펙 판정 표)
    throw new Error("TAGO 시간표 전 호출 실패");
  }

  const lines: TimetableLine[] = [];
  matched.forEach((st, i) => {
    const directions: TimetableDirection[] = [];
    (["up", "down"] as const).forEach((direction, d) => {
      const r = settled[i * 2 + d];
      if (r.status !== "fulfilled") return;
      const fl = deriveFirstLast(ensureItemArray(r.value), st.id);
      if (!fl) return; // 그 방향 유효 행 0 — 생략
      directions.push({
        direction,
        first: withTerminusEn(fl.first),
        last: withTerminusEn(fl.last),
      });
    });
    if (directions.length > 0) lines.push({ lineName: displayLineName(st.routeName), directions });
  });

  return {
    stationName,
    dailyType,
    ...(failures > 0 ? { partial: true as const } : {}),
    lines,
  };
}
