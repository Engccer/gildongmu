import { env } from "../env";
import { parseServiceTime } from "../service-hours";
import { lineHintMatches, normalizeStationName } from "../station-match";
import {
  computeServiceDailyType,
  deriveFirstLast,
  fetchScheduleRows,
  fetchTago,
  parseKeywordStations,
} from "./tago-subway";
import { fetchIsHoliday } from "./holiday";
import type { ServiceHours } from "./bus-service-hours";

/**
 * 지하철 구간 운행 시간(첫차·막차) 조회.
 *
 * 버스 판(`bus-service-hours.ts`)의 지하철 대응물. 버스는 노선 ID 직결 조인이
 * 성립하지만 지하철은 ODsay와 TAGO가 공유하는 식별자가 없어 (역명, 노선명,
 * 방향) 3개로 맞춘다. 세 축 모두 표기가 달라 정규화가 조인의 전부다.
 *
 * ⚠ 이 모듈은 절대 throw하지 않는다. 운행시간은 부가 정보이고, 조회 실패가
 *   길찾기 응답 자체를 죽이면 결함을 고치려다 더 큰 회귀를 만든다.
 *   실패한 구간은 Map에서 빠지고 호출부가 unknown으로 처리한다.
 *
 * 설계 정본 docs/superpowers/specs/2026-08-01-subway-service-hours-design.md
 */

/**
 * 한 요청이 조회할 구간 수 상한(방어). 상류 `normalizeOdsayRoute`가 경로를 3개로
 * 자르고 경로당 환승은 물리적으로 3~4회라 실제로는 도달하지 않는다. 넘긴 구간은
 * unknown으로 떨어진다 — 조용한 절단이 아니라 정직한 미판정이다.
 */
const MAX_REFS = 12;

export interface SubwayLegRef {
  /** ODsay startName — 승차역. 첫차·막차는 역별이라 승차역이 판정 기준이다. */
  stationName: string;
  /** ODsay lane[0].name — "수도권 5호선" 형태(지역 접두어 포함) */
  lineName: string;
  /** ODsay wayCode. 1=상행(TAGO "U"), 2=하행("D") — 실호출 양방향 확정 2026-08-01 */
  wayCode: number;
}

/** 조인 키. leg 쪽과 조회 쪽이 같은 함수를 써야 Map 조회가 어긋나지 않는다. */
export function subwayHoursKey(ref: SubwayLegRef): string {
  return `${normalizeStationName(ref.stationName)}|${ref.lineName.trim().toLowerCase()}|${ref.wayCode}`;
}

/**
 * ODsay 노선명의 매칭 후보를 우선순위 순으로.
 *
 * TAGO는 인천만 노선명에 지역을 남기고("인천1호선") 부산·대구·광주·수도권은
 * 뗀다("1호선"). 그래서 지역을 무조건 제거하면 부평(수도권 1호선 ∩ 인천1호선)
 * 에서 ODsay "인천 1호선"이 두 후보 모두에 걸린다. 지역을 유지한 쪽을 먼저
 * 시도하고 빈손일 때만 제거한 쪽으로 간다.
 *
 * 제거는 첫 공백 앞 토큰 하나만 — 노선명 본체는 건드리지 않는다
 * ("수도권 공항철도" → "공항철도"). 지역 목록을 표로 고정하지 않으므로
 * 미관측 지역("대전 1호선")도 그대로 동작한다.
 */
function lineMatchCandidates(odsayLineName: string): string[] {
  const kept = odsayLineName.trim();
  if (!kept) return [];
  const space = kept.indexOf(" ");
  if (space <= 0) return [kept];
  const stripped = kept.slice(space + 1).trim();
  return stripped && stripped !== kept ? [kept, stripped] : [kept];
}

/**
 * 키워드 검색 결과에서 이 구간의 역을 고른다(순수).
 *
 * 역명은 **정규화 후 완전 일치**만 인정한다 — TAGO 키워드 검색은 포함 검색이라
 * "서울"이 서울역·서울대입구·서울숲을 모두 돌려주고, 부분 일치를 쓰면 같은
 * 노선의 다른 역 시간표를 조인한다.
 *
 * 후보가 2건 이상 남으면 null이다(추측 금지). 교차 도시 동명이역이 같은 노선
 * 번호를 갖는 충돌이 실재한다 — 부산 "시청(연제)" 1호선과 대전 "시청" 1호선은
 * 괄호 제거 후 이름도 노선명도 같다. TAGO 검색 응답엔 도시 필드가 없어 가를
 * 수단이 없으므로 틀린 답 대신 "정보 없음"을 택한다.
 */
export function pickTimetableStation(
  candidates: Array<{ id: string; name: string; routeName: string }>,
  stationName: string,
  odsayLineName: string,
): { id: string } | null {
  const nameKey = normalizeStationName(stationName);
  if (!nameKey) return null;
  const sameName = candidates.filter((c) => normalizeStationName(c.name) === nameKey);
  if (sameName.length === 0) return null;

  for (const hint of lineMatchCandidates(odsayLineName)) {
    const hits = sameName.filter((c) => lineHintMatches(c.routeName, hint));
    if (hits.length === 1) return { id: hits[0].id };
    if (hits.length > 1) return null; // 모호 — 다음 후보로 넘어가도 더 좁혀지지 않는다
  }
  return null;
}

/** 조회 가능한 ref인가 — 세 축이 다 있어야 조인이 성립한다. */
function isJoinable(ref: SubwayLegRef): boolean {
  return (
    ref.stationName.trim().length > 0 &&
    ref.lineName.trim().length > 0 &&
    (ref.wayCode === 1 || ref.wayCode === 2)
  );
}

async function fetchOne(ref: SubwayLegRef, dailyTypeCode: string): Promise<ServiceHours | null> {
  // 키워드 질의도 정규화본으로 — TAGO는 포함 검색이라 "서울역"으로 물으면
  // "서울역"만, "서울"로 물으면 서울로 시작하는 역 전체가 온다. 넓게 받아
  // pickTimetableStation이 완전 일치로 좁히는 쪽이 표기 차이에 강하다.
  const nameKey = normalizeStationName(ref.stationName);
  const keywordRaw = await fetchTago("GetKwrdFndSubwaySttnList", { subwayStationName: nameKey });
  const station = pickTimetableStation(
    parseKeywordStations(keywordRaw),
    ref.stationName,
    ref.lineName,
  );
  if (!station) return null; // 미커버 또는 모호

  // 토요일(02) 빈 결과 → 휴일(03) 폴백은 fetchScheduleRows가 담당한다.
  // 수도권은 토요일 다이어를 제출하지 않아, 폴백이 없으면 토요일마다 판정이 전멸한다.
  const rows = await fetchScheduleRows(station.id, dailyTypeCode, ref.wayCode === 1 ? "U" : "D");
  const firstLast = deriveFirstLast(rows, station.id);
  if (!firstLast) return null; // 그 방향 유효 행 0

  // deriveFirstLast는 표시용 "HH:MM"을 준다. parseServiceTime은 숫자만 받으므로
  // 콜론만 떼어 넘긴다(공유 파서 계약을 넓히면 오염 문자열도 통과한다).
  return {
    firstMinutes: parseServiceTime(firstLast.first.time.replace(":", "")),
    lastMinutes: parseServiceTime(firstLast.last.time.replace(":", "")),
  };
}

/**
 * 지하철 구간들의 운행 시간을 병렬 조회.
 * 실패·미조회 구간은 Map에서 빠진다(호출부가 부재를 unknown으로 읽는다).
 * 키 없으면 빈 Map(게이트 패턴). Map 키는 subwayHoursKey.
 */
export async function fetchSubwayServiceHoursMap(
  refs: SubwayLegRef[],
): Promise<Map<string, ServiceHours>> {
  const map = new Map<string, ServiceHours>();
  if (!env.DATA_GO_KR_API_KEY || refs.length === 0) return map;
  const unique = [
    ...new Map(refs.filter(isJoinable).map((r) => [subwayHoursKey(r), r])).values(),
  ].slice(0, MAX_REFS);
  if (unique.length === 0) return map;

  // 서비스데이 요일 타입은 요청당 1회 — 같은 응답의 모든 구간이 같은 날을 본다.
  // fetchIsHoliday는 판정 불가를 null로 돌려주고 throw하지 않는다(요일 폴백).
  const service = computeServiceDailyType(Date.now());
  const holiday = await fetchIsHoliday(service.date);
  const dailyType = holiday === true ? "sunday" : service.type;
  const dailyTypeCode = dailyType === "weekday" ? "01" : dailyType === "saturday" ? "02" : "03";

  const settled = await Promise.allSettled(
    unique.map(async (ref) => ({
      key: subwayHoursKey(ref),
      hours: await fetchOne(ref, dailyTypeCode),
    })),
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.hours) map.set(r.value.key, r.value.hours);
  }
  return map;
}
