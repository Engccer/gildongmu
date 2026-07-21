/**
 * 국토교통부 TAGO(국가대중교통정보센터) 지하철 노선정보(B-3) provider.
 *
 * 2종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유, Base SubwayInfo,
 * 오퍼레이션 첫 글자 대문자, 소문자 get은 "API not found"):
 * - `GetKwrdFndSubwaySttnList`: 역명 키워드 검색(포함검색, 정확매칭은 호출부 책임)
 * - `GetSubwaySttnAcctoSchdulList`: 역·서비스데이별 전체 발차 스케줄
 *
 * 이 파일은 순수 파싱·산출 로직만 담는다(fetch 통합은 다음 태스크의
 * fetchStationTimetable). BASE·PAGE_SIZE는 그 통합이 그대로 재사용한다.
 *
 * 첫차·막차 산출의 핵심은 "서비스데이" 개념이다: 00~02시대 심야 열차는
 * 달력상 다음 날이지만 운행상으로는 전날 막차의 연장이다. 03:00 미만
 * depTime을 +24h 보정해 정렬하면 첫차=최소·막차=최대로 정확히 갈린다.
 * 03:00 경계는 국내 도시철도가 공통으로 갖는 운행 공백(대략 01~05시)에
 * 놓인 휴리스틱이며, 실제 임계 시각이 아니라 안전하게 그 공백 안에만
 * 있으면 되는 값이다(스펙 §1-A-1).
 */

export const BASE = "http://apis.data.go.kr/1613000/SubwayInfo";
export const PAGE_SIZE = 500;
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
