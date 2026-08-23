import { env } from "../env";
import { parseStationQuery, lineHintMatches, normalizeStationName } from "../station-match";
import { findStationsByName } from "../subway-stations";
import { fetchIsHoliday } from "./holiday";
import { fetchDataGoKrJson, readItems, readResultCode, readTotalCount } from "./datagokr-envelope";
import type { StationTimetable, TimetableLine, TimetableLineCoverage, TimetableDirection, TimetableTrain } from "../types";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 지하철 노선정보(B-3) provider.
 *
 * 2종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유, Base SubwayInfo,
 * 오퍼레이션 첫 글자 대문자, 소문자 get은 "API not found"):
 * - `GetKwrdFndSubwaySttnList`: 역명 키워드 검색(포함검색, 정확매칭은 호출부 책임)
 * - `GetSubwaySttnAcctoSchdulList`: 역·서비스데이별 전체 발차 스케줄
 *
 * 순수 파싱·산출 로직과 fetch 통합(fetchStationTimetable)을
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
 * 결과 + partial:true. **매칭된 노선은 편성이 0이어도 lines에서 빼지 않는다** —
 * `coverage`가 그 이유를 들고 실린다(스펙 `2026-08-23-tago-timetable-coverage-design.md`).
 */

// ⚠ https 필수: http는 연결만 되고 응답이 오지 않는다(read ETIMEDOUT hang,
// 같은 요청이 https로는 0.07초. 실측 2026-08-04). 끊기지 않고 매달리므로 증상이
// "실패"가 아니라 "느림"으로 나오고, revalidate 캐시도 채워지지 않아 매 요청이
// 같은 시간을 다시 쓴다. 타임아웃은 fetchTago가 AbortSignal로 이중 방어한다.
const BASE = "https://apis.data.go.kr/1613000/SubwayInfo";
const PAGE_SIZE = 500;
// 키워드 매칭 노선 수 상한 — 환승역 등에서 노선별 상·하행 조회가 무한 증폭되지
// 않도록 방어(스펙 §2-A). 실서비스 환승역도 이 상한을 넘지 않는다.
const MAX_LINES = 8;
const SERVICE_DAY_BOUNDARY = 30000; // HHMMSS 수치 03:00:00(위 헤더의 서비스데이 경계 휴리스틱)

export function parseKeywordStations(raw: unknown): Array<{ id: string; name: string; routeName: string }> {
  return readItems(raw)
    .map((o) => {
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

type FirstLast = { first: { time: string; nextDay?: true; terminus: string }; last: { time: string; nextDay?: true; terminus: string } };

/**
 * 한 방향의 스케줄 행을 4분류한다(스펙 §2 방향 4분류). 호출 rejected(unavailable)는
 * 호출부가 가른다.
 * - 원시 0행 → unknown: 업스트림은 존재하지 않는 파라미터 값에도 `00`+0행을 주므로
 *   0행은 무정보다(dodo 실측 2026-08-23). "운행 없음"으로 읽을 근거가 없다.
 * - 파싱 가능 행 0 → unknown: 우리 파서가 못 읽은 것이지 열차가 없는 것이 아니다.
 *   (같은 TAGO 계열 버스 API가 선행 0 없는 시각을 JSON 숫자로 보낸 전력이 있다.)
 * - 파싱 가능 ≥1 + 편성 0(전부 당역 종착) → noTrains: 탑승 불가가 참이다.
 * - 편성 ≥1 → ok + 첫차·막차.
 */
export function classifyDirection(
  rows: unknown[],
  stationId: string,
): { outcome: TimetableLineCoverage; fl: FirstLast | null } {
  let parsable = 0;
  const candidates = rows.flatMap((r) => {
    const o = r as ScheduleRow;
    const dep = o.depTime == null ? "" : String(o.depTime);
    if (!/^\d{6}$/.test(dep)) return []; // 파서가 못 읽은 행 — parsable에 세지 않는다
    parsable += 1;
    if (String(o.endSubwayStationId ?? "") === stationId) return []; // 당역 종착(탑승 불가, 읽기는 성공)
    const raw = Number(dep);
    const adjusted = raw < SERVICE_DAY_BOUNDARY ? raw + 240000 : raw;
    const train = {
      time: `${dep.slice(0, 2)}:${dep.slice(2, 4)}`,
      ...(raw < SERVICE_DAY_BOUNDARY ? { nextDay: true as const } : {}),
      terminus: o.endSubwayStationNm == null ? "" : String(o.endSubwayStationNm),
    };
    return [{ adjusted, train }];
  });
  if (candidates.length === 0) return { outcome: parsable === 0 ? "unknown" : "noTrains", fl: null };
  candidates.sort((a, b) => a.adjusted - b.adjusted);
  return { outcome: "ok", fl: { first: candidates[0].train, last: candidates[candidates.length - 1].train } };
}

/**
 * 첫차·막차 산출(스펙 §1-A 계약). 서비스데이 정렬·당역종착 제외·행 유효성 가드·익일 판정.
 * 편성이 없으면 null — 그 null이 unknown인지 noTrains인지는 `classifyDirection`이 가른다
 * (`subway-service-hours`는 부재를 Map miss → unknown으로 읽으므로 이 시그니처로 충분하다).
 */
export function deriveFirstLast(rows: unknown[], stationId: string): FirstLast | null {
  return classifyDirection(rows, stationId).fl;
}

/**
 * 방향별 판정들을 노선 하나의 coverage로 결합한다(스펙 §2). 첫 매칭 우선순위이며
 * **행 순서 자체가 불변식**이다: ok > unavailable > unknown > noTrains.
 * 1은 사용자에게 유리한 쪽(한 방향이라도 타면 실제 시간표가 도달한다), 2·3이 4보다
 * 먼저인 것은 단정 회피다 — noTrains는 "안 다닙니다"라는 확정 진술을 만들고
 * unknown·unavailable은 만들지 않는다. 모르는 방향이 섞였는데 확정 쪽으로 결합하면
 * 그 노선이 실제로 다닐 때 거짓이고, `judgeStationService`가 noTrains를 판정에
 * 참여시키므로 "운행 종료, 첫차 X"까지 따라 나간다.
 */
export function combineLineCoverage(outcomes: readonly TimetableLineCoverage[]): TimetableLineCoverage {
  if (outcomes.includes("ok")) return "ok";
  if (outcomes.includes("unavailable")) return "unavailable";
  if (outcomes.includes("unknown")) return "unknown";
  return "noTrains";
}

/**
 * TAGO 오퍼레이션 공통 호출. 모양 방어는 공용 `fetchDataGoKrJson`이 하고,
 * 여기 남는 것은 이 서비스의 정책 둘이다: 허용 resultCode("00"/"03")와
 * 페이지 누락 금지(totalCount > PAGE_SIZE면 조용한 절단이므로 throw).
 * `subway-service-hours`가 재사용한다 — envelope 처리본을 또 만들지 않는다.
 */
export async function fetchTago(op: string, params: Record<string, string>): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const search = new URLSearchParams({
    serviceKey: key, _type: "json", numOfRows: String(PAGE_SIZE), pageNo: "1", ...params,
  });
  const raw = await fetchDataGoKrJson(`${BASE}/${op}?${search}`, `TAGO ${op}`, {
    next: { revalidate: 86_400 },
    // hang 이중 방어(https 전환과 별개) — 대중교통 경로가 이 조회를 await하므로
    // 한 노선이 매달리면 길찾기 응답 전체가 그만큼 늦어진다.
    signal: AbortSignal.timeout(10_000),
  });
  // 00 정상. NODATA류가 별코드(03)로 오면 통과(빈 items 처리) — 그 외는 throw.
  const code = readResultCode(raw) ?? "";
  if (code !== "00" && code !== "03") throw new Error(`TAGO ${op} resultCode ${code}`);
  const total = readTotalCount(raw);
  if (total > PAGE_SIZE) throw new Error(`TAGO ${op} totalCount(${total}) > ${PAGE_SIZE} — 페이지 누락`);
  return raw;
}

/**
 * 역·방향 시간표 행 조회. 토요일(02)이 빈 결과면 휴일(03)로 한 번 더 묻는다.
 *
 * ⚠ 수도권 운영사는 토요일 다이어를 따로 제출하지 않는다(실호출 2026-08-01:
 *   길동 5호선·잠실 2호선 모두 02가 정상 응답 + 0행이고 01·03만 데이터를 갖는다.
 *   부산 1호선은 02도 164행이라 지역별로 갈린다). 폴백이 없으면 수도권 첫차·막차가
 *   **토요일마다 통째로 사라진다** — 실호출 게이트로 발견한 선재 결함이다.
 *   평일 대비 휴일 다이어는 첫차가 같고 막차만 이르다(길동 00:38→00:00).
 *
 * usedDailyTypeCode는 행이 있을 때만 채운다(없으면 null) — 호출부가 "어느
 * 다이어로 답했는지"를 사용자에게 정직하게 표기할 수 있어야 한다.
 */
export async function fetchScheduleOnce(
  stationId: string,
  dailyTypeCode: string,
  dir: "U" | "D",
): Promise<unknown[]> {
  return readItems(
    await fetchTago("GetSubwaySttnAcctoSchdulList", {
      subwayStationId: stationId,
      dailyTypeCode,
      upDownTypeCode: dir,
    }),
  );
}

/**
 * 한 구간(역·방향)의 시간표 행. 토요일이 빈 결과면 휴일로 한 번 더 묻는다.
 *
 * 폴백을 **구간 단위**로 결정해도 되는 이유: 이 함수의 소비자(경로 운행시간
 * 판정)는 역 하나·노선 하나·방향 하나만 다루므로 한 응답 안에 서로 다른
 * 다이어가 섞일 수 없다. 반면 역 상세 시간표는 여러 노선을 하나의 기준 라벨로
 * 묶어 표기하므로 폴백을 역 단위로 결정해야 한다(fetchStationTimetable 참조).
 */
export async function fetchScheduleRows(
  stationId: string,
  dailyTypeCode: string,
  dir: "U" | "D",
): Promise<unknown[]> {
  const rows = await fetchScheduleOnce(stationId, dailyTypeCode, dir);
  if (rows.length > 0 || dailyTypeCode !== "02") return rows;
  return fetchScheduleOnce(stationId, "03", dir);
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
  // 폴백을 **역 단위**로 결정한다. 이 응답은 여러 노선을 기준 라벨 하나로 묶어
  // 표기하므로, 노선마다 다른 다이어를 섞으면 그 라벨이 거짓이 된다.
  // 실측(2026-08-01): 대저역은 부산3호선이 토요일 150행인데 부산김해경전철은
  // 0행이라 구간 단위로 폴백하면 "토요일 기준" 라벨 아래 휴일 값이 섞인다.
  // 한 노선이라도 토요일에 답하면 그 역은 토요일 다이어를 갖는 역이므로
  // 폴백하지 않고, 답하지 못한 노선은 미노출로 정직하게 빠진다.
  let settled = await Promise.allSettled(
    jobs.map(({ st, dir }) => fetchScheduleOnce(st.id, dailyTypeCode, dir)),
  );
  let usedDailyTypeCode = dailyTypeCode;
  const answered = settled.some((r) => r.status === "fulfilled" && r.value.length > 0);
  if (!answered && dailyTypeCode === "02") {
    settled = await Promise.allSettled(jobs.map(({ st, dir }) => fetchScheduleOnce(st.id, "03", dir)));
    usedDailyTypeCode = "03";
  }
  const failures = settled.filter((r) => r.status === "rejected").length;
  if (failures === settled.length) {
    // 전 호출 실패 — "운행 없음"으로 위장 금지(스펙 판정 표)
    throw new Error("TAGO 시간표 전 호출 실패");
  }

  // 매칭된 노선은 **전부** 실린다(키워드가 확인한 존재를 스케줄 0행이 부재로 뒤집지 않는다).
  const lines: TimetableLine[] = matched.map((st, i) => {
    const directions: TimetableDirection[] = [];
    const outcomes: TimetableLineCoverage[] = [];
    (["up", "down"] as const).forEach((direction, d) => {
      const r = settled[i * 2 + d];
      if (r.status !== "fulfilled") {
        outcomes.push("unavailable");
        return;
      }
      const { outcome, fl } = classifyDirection(r.value, st.id);
      outcomes.push(outcome);
      if (fl) directions.push({ direction, first: withTerminusEn(fl.first), last: withTerminusEn(fl.last) });
    });
    return { lineName: displayLineName(st.routeName), coverage: combineLineCoverage(outcomes), directions };
  });

  // 답한 다이어를 그대로 표기한다. 토요일 요청에 휴일 다이어로 답했는데
  // "토요일 기준"이라 쓰면 거짓이다(수도권은 토요일 다이어 자체가 없다).
  // 위에서 폴백을 역 단위로 결정했으므로 이 라벨은 모든 노선에 대해 참이다.
  const reportedType = usedDailyTypeCode === "03" && dailyType === "saturday" ? "sunday" : dailyType;

  return {
    stationName,
    dailyType: reportedType,
    ...(failures > 0 ? { partial: true as const } : {}),
    lines,
  };
}
