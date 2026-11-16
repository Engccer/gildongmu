import type { TrackItem } from "./transit-guide";
import { subwayIdForOdsayLine } from "./transit-guide";
import type { BusRouteStop, BusStop } from "./types";
import {
  fetchSeoulRideSlots,
  fetchSeoulRouteStops,
  fetchSeoulStopRoutes,
  fetchSeoulWaitSlots,
  type SeoulTrackSlot,
} from "./providers/seoul-bus";
import { fetchServiceHoursMap } from "./providers/bus-service-hours";
import { RESERVATION_LANE } from "./providers/odsay";
import { judgeServiceStatus, kstNowMinutes } from "./service-hours";
import { toDisplayEnglish } from "./transit-name-en";
import { SEOUL_WAIT_ROUTE_SET_MAX as WAIT_SET_MAX } from "./transit-guide";
import { fetchTagoArrivals, fetchTagoStopsNear } from "./providers/tago-bus";
import {
  fetchSubwayArrivals,
  subwayLineNameForId,
  withArrivalsEn,
} from "./providers/seoul-subway-arrival";
import { busArrivalMessageEnFrom } from "./bus-arrival-en";
import { stationNameEn } from "./subway-arrival-en";
import { fetchSubwayLinePositions, type SubwayTrainPosition } from "./providers/seoul-subway-position";
import { normalizeStationName } from "./station-match";
import { findStationsByName } from "./subway-stations";
import type { DataLang } from "./lang-param";

/**
 * 대중교통 추적 폴링 서비스(B2 §7) — provider 봉투 차이를 여기서 흡수해
 * `/api/transit/track`이 판별 union만 내려보내게 한다(클라는 봉투를 모른다).
 *
 * 3-state 규율: 미등장(empty)·추적 불가(unsupported)·upstream 오류(throw→502)를
 * 절대 뭉개지 않는다. TrackItem은 상태 머신(transit-guide)과 같은 형태다.
 */

export type TransitTrackResult =
  | { status: "ok"; items: TrackItem[]; rawCount: number }
  | { status: "empty"; rawCount: number }
  | { status: "unsupported" };

/**
 * rawCount = 노선·경로 필터 **전** 원시 건수(§13.3, additive). empty ∧ rawCount>0
 * = "필터 전멸"(그 정류소·역에 도착은 있는데 이 노선이 아니다) — 진짜 0건과
 * 구분해 대기 국면 0건 사유 3-state와 실험판 계측이 소비한다.
 */
function withItems(items: TrackItem[], rawCount: number): TransitTrackResult {
  return items.length > 0 ? { status: "ok", items, rawCount } : { status: "empty", rawCount };
}

/** 지하철 영문 역명 조회의 seed 바인딩(순수 함수에 주입 — `withArrivalsEn`과 같은 바인딩). */
const SUBWAY_EN_CTX = { findStations: findStationsByName };

/**
 * 영문 조각 한 칸 — **빈 문자열도 한글이 섞인 값도 싣지 않는다**(spec §3.4 ⚠, §5.1).
 *
 * ① `""`는 "이 자리는 비어도 된다"가 아니라 정보 소실이라, 그대로 두면 줄 원자성 판정이
 * "완비"로 읽어 `Boarded . Get off at .` 같은 줄을 만든다(`messageEn`의 `""`(TAGO)만 예외이고
 * 그 자리는 이 헬퍼를 지나지 않는다).
 * ② **필드 존재 ≠ 영문**(E27 §3.1 리뷰 #12와 같은 규칙). 표시 계층의 타입 분리는 *우리 코드가
 * 조인 값을 읽지 않는다*만 보증하고, **서버가 영문 자리에 한국어를 실어 보내는 방향**은
 * 타입을 그대로 통과한다 — seed 영문이 비어 한글로 채워지거나 provider 문구가 바뀌면
 * `Boarded 수도권 5호선`이 "영어 줄"로 판정된다. 그 방향을 여기서 fail-closed로 막는다.
 */
export function englishFieldOnly(key: string, value: string | undefined): Record<string, string> {
  if (value == null || value.trim() === "" || HANGUL.test(value)) return {};
  return { [key]: value };
}

const HANGUL = /[가-힣]/;

// === 서울 버스 ===

/**
 * 슬롯 → 추적 항목. **국면 인자는 필수다** — 같은 원문이 대기(버스가 여기 오기까지)와 승차
 * (내릴 곳까지)에서 뜻이 달라 영문 투영의 어순이 갈린다(`busArrivalMessageEn`). 기본값을 두면
 * 신규 호출부가 국면을 빠뜨려도 컴파일이 통과해 조용히 틀린 문장을 낸다
 * ([[no-default-for-safety-parameters]]).
 */
function slotToItem(
  slot: SeoulTrackSlot,
  phase: "wait" | "ride",
  lang: DataLang,
  withRoute: boolean,
): TrackItem {
  const messageEn = lang === "en" ? busArrivalMessageEnFrom(slot.message, phase) : undefined;
  return {
    vehicleId: slot.vehicleId,
    direction: "",
    // ⚠ **원문을 변형하지 않는다**(E39). 종전에는 승차 국면에서 꼬리를 떼고 어미를 고쳐 실었는데,
    // 그 재작성은 이 상태 문장 하나만을 위한 것이었고 지금은 클라이언트가 `parseBusArrmsg`로
    // 구조를 읽어 자기 언어의 문장을 만든다 — 재작성본을 다시 파싱하면 같은 원문을 두 계층이
    // 각자 해석하는 상태가 된다(spec 2026-09-12-transit-status-prose §1.4).
    message: slot.message,
    remainingStops: slot.remainingStops,
    destinationName: null,
    express: false,
    arrivalCode: null,
    // 방향·종착역은 서울버스에 **구조적으로 없다**(ko도 ""·null) — 영문 자리도 만들지 않는다.
    ...(messageEn ? { messageEn } : {}),
    // 노선 집합 대기 폴(E76)에만 — 단일 노선 폴 응답은 종전과 byte-identical(기존 앱 디코더 무변화).
    ...(withRoute && slot.routeId ? { route: slot.routeId } : {}),
  };
}

/** 노선 집합 대기 폴의 상한(E76) — 정본은 클라이언트와 공유하는 `transit-guide.ts`. */
export { SEOUL_WAIT_ROUTE_SET_MAX } from "./transit-guide";

/**
 * 노선 집합 대기 항목 정렬(E76 §3.2): 잔여 정거장 오름차순, 잔여를 모르면 뒤, 같으면 응답 순서(안정 정렬).
 * 단일 노선 폴은 정렬하지 않는다(종전 순서 = 슬롯1·슬롯2 순서가 그 노선의 도착 순서다).
 * ⚠ 예상 시각(`traTime`)으로 정렬하지 않는다 — 운행종료에도 비0이라 신뢰 불가다(도착 낭독 정본 규칙).
 */
export function sortByRemaining<T extends { remainingStops: number | null }>(items: T[]): T[] {
  const rank = (n: number | null) => (n == null ? Number.POSITIVE_INFINITY : n);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.remainingStops) - rank(b.item.remainingStops) || a.i - b.i)
    .map(({ item }) => item);
}

/**
 * 승차 대기: 승차 정류소(arsId)의 그 노선 도착 슬롯(vehId 보존 — 잠금 선택지).
 * `routeIds`(E76)를 주면 그 노선들의 도착을 한 목록으로 — 같은 하차 정류소에 서는 노선 전부를 고를 수 있게 —
 * 항목마다 `route`(busRouteId)를 싣고 잔여순으로 정렬한다. 둘 중 하나만 온다(라우트가 가른다).
 */
export async function trackSeoulWait(
  params: { arsId: string; lang: DataLang } & (
    | { routeId: string; routeIds?: undefined }
    | { routeIds: string[]; routeId?: undefined }
  ),
): Promise<TransitTrackResult> {
  if (params.routeIds) {
    const { slots, rawCount } = await fetchSeoulWaitSlots(params.arsId, new Set(params.routeIds));
    return withItems(
      sortByRemaining(slots.map((s) => slotToItem(s, "wait", params.lang, true))),
      rawCount,
    );
  }
  const { slots, rawCount } = await fetchSeoulWaitSlots(params.arsId, params.routeId);
  return withItems(
    slots.map((s) => slotToItem(s, "wait", params.lang, false)),
    rawCount,
  );
}

/**
 * 하차 정류소 ord 해석(§5.2 순수 판정): 승차 정류소 순번보다 큰 것 중 최소.
 * 순환·왕복 노선의 중복 정류소에서 반대 구간 차량을 읽는 오류를 차단한다.
 * 해석 불가(승차·하차 미발견, 순서 역전)는 null.
 */
export function pickAlightOrd(
  stops: BusRouteStop[],
  boardLocalId: string,
  alightLocalId: string,
): number | null {
  const boardOrders = stops.filter((s) => s.nodeId === boardLocalId).map((s) => s.order);
  if (boardOrders.length === 0) return null;
  const boardOrd = Math.min(...boardOrders);
  const alightOrders = stops
    .filter((s) => s.nodeId === alightLocalId && s.order > boardOrd)
    .map((s) => s.order);
  if (alightOrders.length === 0) return null;
  return Math.min(...alightOrders);
}

/** 하차 카운트다운: ord 해석(캐시 실패 시 fresh 1회) 후 getArrInfoByRoute 슬롯. */
export async function trackSeoulRide(params: {
  routeId: string;
  boardLocalId: string;
  alightLocalId: string;
  lang: DataLang;
}): Promise<TransitTrackResult> {
  const { routeId, boardLocalId, alightLocalId, lang } = params;
  let ord = pickAlightOrd(await fetchSeoulRouteStops(routeId), boardLocalId, alightLocalId);
  if (ord == null) {
    // 캐시가 낡았을 수 있다(임시 우회·노선 변경, §5.2) — 우회 재조회 1회.
    ord = pickAlightOrd(
      await fetchSeoulRouteStops(routeId, { fresh: true }),
      boardLocalId,
      alightLocalId,
    );
  }
  if (ord == null) {
    // 잘못된 ord로 반대 구간 차량을 읽는 것보다 정직한 추적 불가가 낫다(§5.2).
    return { status: "unsupported" };
  }
  const slots = await fetchSeoulRideSlots(alightLocalId, routeId, ord);
  // getArrInfoByRoute는 이미 노선 스코프 조회라 필터가 없다 — rawCount = 항목 수.
  return withItems(
    slots.map((s) => slotToItem(s, "ride", lang, false)),
    slots.length,
  );
}

/** 재기준 집합(E76 후속 ⓔ)의 경유 정류소 조회 동시 상한 — TOPIS에 한 번에 몰지 않는다(하루 캐시라 대개 캐시 적중). */
export const SEOUL_LANES_CONCURRENCY = 5;

/** 서울 노선 운행 시간 조회 도시 코드(ODsay busCityCode 서울 = 1000, `fetchServiceHoursMap`이 TOPIS로 보낸다). */
const SEOUL_CITY_CODE = 1000;

/**
 * 재기준 집합의 경유 조회 하루 예산(인스턴스 단위, E76 후속 ⓔ 리뷰 M2). **메모리 캐시 뒤에** 둔다 — 적중은 예산을 쓰지 않는다
 * (앞에 두면 이미 캐시된 노선까지 막는다). 공공데이터포털 개발계정 보수 가정(오퍼레이션당 일 1,000회)의 30%.
 */
export const SEOUL_LANES_DAILY_MISS_BUDGET = 300;

const routeStopsMemo = new Map<string, { day: string; stops: BusRouteStop[] }>();
const routeStopsInFlight = new Map<string, Promise<BusRouteStop[]>>();
const missBudget = { day: "", used: 0 };

/** KST 날짜 키(하루 캐시·예산의 경계). */
function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 테스트 전용 — 메모리 캐시·예산을 비운다. */
export function resetSeoulLanesMemoForTest(): void {
  routeStopsMemo.clear();
  routeStopsInFlight.clear();
  missBudget.day = "";
  missBudget.used = 0;
}

/**
 * 노선 경유(재기준 집합용): 메모리 하루 캐시 → 같은 노선 동시 요청 합침 → 예산 → `fetchSeoulRouteStops`(Next 하루 캐시).
 * 예산 소진은 throw(그 노선은 `unverified`). 실패는 캐시하지 않는다.
 */
async function routeStopsForLanes(routeId: string, now: Date): Promise<BusRouteStop[]> {
  const day = kstDay(now);
  const memo = routeStopsMemo.get(routeId);
  if (memo && memo.day === day) return memo.stops;
  const pending = routeStopsInFlight.get(routeId);
  if (pending) return pending;
  if (missBudget.day !== day) {
    missBudget.day = day;
    missBudget.used = 0;
  }
  if (missBudget.used >= SEOUL_LANES_DAILY_MISS_BUDGET) throw new Error("재기준 집합 경유 조회 예산 소진");
  missBudget.used++;
  const p = fetchSeoulRouteStops(routeId)
    .then((stops) => {
      routeStopsMemo.set(routeId, { day, stops });
      return stops;
    })
    .finally(() => routeStopsInFlight.delete(routeId));
  routeStopsInFlight.set(routeId, p);
  return p;
}

/**
 * 재기준 집합 자격(순수): 그 정류소가 노선 경유에 **정확히 한 번** 나오고 그 뒤에 하차 정류소가 온다. 두 번 이상이면(순환·회차)
 * 사용자가 선 회차를 정류소 ID로 가를 수 없어 뺀다 — `pickAlightOrd`는 첫 회차를 골라 지난 구간을 읽을 수 있다(리뷰 H2).
 */
export function reachesAlightOnce(stops: BusRouteStop[], boardLocalId: string, alightLocalId: string): boolean {
  if (stops.filter((s) => s.nodeId === boardLocalId).length !== 1) return false;
  return pickAlightOrd(stops, boardLocalId, alightLocalId) != null;
}

export interface SeoulLaneRoute {
  routeId: string;
  lineName: string;
  lineNameEn?: string;
}

/** 동시 상한 `limit`으로 차례대로 실행(실패는 항목별 `rejected` — 하나가 전체를 죽이지 않는다). */
async function settleLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * 지금 서 있는 정류소 기준 노선 집합(E76 후속 ⓔ, spec `2026-11-07-e76-followup-design.md` §2.3). 그 정류소(`arsId`)에 서는
 * 노선 중 **지금 노선(`routeId`)을 뺀** 나머지에서, 경유 정류소(하루 캐시)에서 그 정류소(`boardLocalId`) 뒤에 하차 정류소
 * (`alightLocalId`)가 오는 노선만 낸다(판정 ⓑ와 같은 기준, `pickAlightOrd`). 클라이언트가 `[지금 노선] + routes`로 집합을 만든다.
 *
 * 3-state: 정류소 조회 실패는 throw(502 — 단일 노선 대기가 계속된다). 노선 하나의 경유 조회 실패·예산 소진·순환 회차 모호는
 * 그 노선을 **뺀다**(`unverified`) — 모르면 엉뚱한 곳으로 가는 버스를 고르게 할 수 있다(운행 시간 판정 불가를 남기는 것과
 * 방향이 반대다).
 * 운행 시간은 E76 §2.3과 같다(밖으로 **판정된** 노선만 뺀다).
 */
export async function trackSeoulLanes(params: {
  arsId: string;
  boardLocalId: string;
  alightLocalId: string;
  routeId: string;
  lang: DataLang;
}): Promise<{ status: "ok"; routes: SeoulLaneRoute[]; checked: number; unverified: number }> {
  const candidates = (await fetchSeoulStopRoutes(params.arsId)).filter(
    (r) => r.routeId !== params.routeId && !RESERVATION_LANE.test(r.routeNo),
  );
  const now = new Date();
  const settled = await settleLimited(candidates, SEOUL_LANES_CONCURRENCY, async (r) => {
    const stops = await routeStopsForLanes(r.routeId, now);
    const boardCount = stops.filter((s) => s.nodeId === params.boardLocalId).length;
    // 순환·회차로 두 번 나오면 판정 불가. 0번도 판정 불가다 — 후보는 이 정류소의 노선 목록에서 왔으므로 경유에 없으면
    // 정류소 ID 축(`arsId`↔`localId`)이 어긋난 것이다(정상 탈락으로 세면 클라이언트가 단일 노선 확정으로 읽는다, 코드 리뷰 MAJOR).
    if (boardCount !== 1) return "ambiguous" as const;
    return reachesAlightOnce(stops, params.boardLocalId, params.alightLocalId);
  });
  let unverified = 0;
  const reaching = candidates.filter((_, i) => {
    const r = settled[i];
    if (r.status === "rejected" || r.value === "ambiguous") {
      unverified++;
      return false;
    }
    return r.value;
  });
  const hours = await fetchServiceHoursMap(
    reaching.map((r) => ({ localId: r.routeId, cityCode: SEOUL_CITY_CODE, routeNo: r.routeNo })),
  );
  const nowMinutes = kstNowMinutes(now);
  const running = reaching.filter((r) => {
    const h = hours.get(r.routeId);
    return !h || judgeServiceStatus(nowMinutes, h.firstMinutes, h.lastMinutes) !== "outside";
  });
  const routes = running.slice(0, WAIT_SET_MAX - 1).map((r): SeoulLaneRoute => {
    const lineNameEn = params.lang === "en" ? toDisplayEnglish(r.routeNo) : undefined;
    return { routeId: r.routeId, lineName: r.routeNo, ...(lineNameEn ? { lineNameEn } : {}) };
  });
  return { status: "ok", routes, checked: candidates.length, unverified };
}

// === 지방 버스(TAGO 근사) ===

/**
 * 하차 정류소 해석의 왕복쌍 모호 가드(§5.2 순수 판정): 최근접 후보와 **동명**인
 * 정류소가 40m 이내에 하나라도 더 있으면 반대편 오선택 위험이 판별 불가 —
 * 추적을 시작하지 않는다. ⚠ 바로 다음 순위만 보면 안 된다: 도심 밀집 지역에선
 * 왕복 짝 사이에 다른 이름의 정류소가 더 가깝게 끼어들 수 있다(독립 리뷰).
 */
export function pickTagoStop(stops: BusStop[]): BusStop | "ambiguous" | null {
  if (stops.length === 0) return null;
  const top = stops[0];
  const twin = stops
    .slice(1)
    .some(
      (s) => s.distanceMeters - top.distanceMeters < 40 && s.name.trim() === top.name.trim(),
    );
  return twin ? "ambiguous" : top;
}

/** 세션 시작 시 1회: passStopList 좌표 → TAGO 정류소(nodeId·citycode) 해석(§5.2). */
export async function resolveTagoStop(params: {
  lat: number;
  lng: number;
}): Promise<
  | { status: "ok"; stop: { nodeId: string; cityCode: string; name: string } }
  | { status: "unsupported" }
> {
  const picked = pickTagoStop(await fetchTagoStopsNear(params.lat, params.lng));
  if (picked === null || picked === "ambiguous") return { status: "unsupported" };
  return {
    status: "ok",
    stop: { nodeId: picked.nodeId, cityCode: picked.cityCode, name: picked.name },
  };
}

/**
 * 대기·카운트다운 공용(같은 도착 API): 그 정류소의 노선 번호 일치 도착만. `routeNos`(E76 후속 ⓓ)를 주면 그 노선들의
 * 도착을 한 목록으로 — 항목마다 `route`(노선 번호)를 싣고 잔여순으로 정렬한다. TAGO 도착 API는 정류소 전 노선을 한 번에
 * 주므로 집합 폴도 upstream 호출은 한 번이다. 둘 중 하나만 온다(라우트가 가른다).
 */
export async function trackTago(
  params: { cityCode: string; nodeId: string; lang: DataLang } & (
    | { routeNo: string; routeNos?: undefined }
    | { routeNos: string[]; routeNo?: undefined }
  ),
): Promise<TransitTrackResult> {
  const arrivals = await fetchTagoArrivals(params.cityCode, params.nodeId);
  const set = params.routeNos ? new Set(params.routeNos) : null;
  const items = arrivals
    .filter((a) => (set ? set.has(a.routeNo) : a.routeNo === params.routeNo))
    .map(
      (a): TrackItem => ({
        vehicleId: null, // TAGO는 차량 식별자가 없다(근사, 조사 §1.2)
        direction: "",
        message: "", // 완성 문장 없음 — 표시 조립은 클라 i18n 몫(재조합 아님)
        remainingStops: a.prevStationCount,
        destinationName: null,
        express: false,
        arrivalCode: null,
        // ⚠ `""`를 **싣는다**(빼지 않는다). ko에도 완성 문장이 없는 자리라 이것은 부재가 아니라
        // 자리 표시이고, 빼면 줄 원자성 판정이 "영문 결측"으로 읽어 en 사용자의 지방버스 줄이
        // 전부 한국어로 폴백한다(spec §3.2 행렬).
        ...(params.lang === "en" ? { messageEn: "" } : {}),
        // 노선 집합 폴(E76 후속 ⓓ)에만 — 단일 노선 폴 응답은 종전과 byte-identical.
        ...(set ? { route: a.routeNo } : {}),
      }),
    );
  return withItems(set ? sortByRemaining(items) : items, arrivals.length);
}

// === 지하철(수도권) ===

/** arvlMsg2에서 잔여 역 수 추출(§6.2): "[N]번째 전역" / "전역 …"=1. 실패는 null. */
export function remainingFromArvlMsg(message: string): number | null {
  const m = message.match(/\[(\d+)\]번째 전역/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (/^전역\s/.test(message) || message === "전역") return 1;
  return null;
}

/**
 * arvlCd 기반 잔여 폴백(§12.2): 0 진입·1 도착·2 출발(당역)=0, 3 전역출발·
 * 4 전역진입·5 전역도착=1. 99(운행중)·미지는 null. arvlMsg2 패턴 실패
 * ("곧 도착"류)에서 사다리가 죽지 않게 하는 보조 신호 — 패턴이 1차 정본.
 */
export function remainingFromArvlCd(code: string | null | undefined): number | null {
  if (code === "0" || code === "1" || code === "2") return 0;
  if (code === "3" || code === "4" || code === "5") return 1;
  return null;
}

/**
 * 완성 문장과 어긋나는 도착 코드를 운행중(99)으로 읽는다. `arvlCd`는 조회 역 기준이어야 하는데
 * 8호선은 `[N]번째 전역` 행에 열차가 지금 선 역 기준 코드(1 도착 등)를 싣는다(실승차 2026-11-13:
 * 하차역까지 7역 남은 열차의 코드 1이 확정 도착으로 오발). 문장이 1차 정본이라(§6.2) 둘이 서로 다른
 * 잔여를 말하면 코드를 버린다. 한쪽이 잔여를 말하지 않으면 모순이 아니다.
 */
export function reconcileArvlCd(message: string, code: string | null | undefined): string | null {
  if (code == null) return null;
  const fromMsg = remainingFromArvlMsg(message);
  const fromCode = remainingFromArvlCd(code);
  if (fromMsg != null && fromCode != null && fromMsg !== fromCode) return "99";
  return code;
}

/** 종착 상태 코드(당역 1 도착·2 출발, 전역 5 도착) — 동결 레코드 판정 축(§12.1 ⓑ). */
const TERMINAL_ARVL_CODES = new Set(["1", "2", "5"]);
/** 이 lag를 넘긴 종착 상태 레코드는 동결로 판정한다(실측 2026-08-06). */
export const STALE_FROZEN_SECONDS = 120;

/** recptnDt("yyyy-MM-dd HH:mm:ss", KST) → epoch ms. 형식 밖은 null. */
export function parseRecptnDt(raw: string): number | null {
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  // 서버 TZ와 무관하게 KST 명시 오프셋으로 해석한다(Vercel=UTC·로컬=KST).
  const ms = Date.parse(`${m[1]}T${m[2]}+09:00`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 데이터 나이(초) 판정(§12.1 신선도 게이트): ⓐ 미래값(신분당선 고장)은 0으로
 * 클램프 ⓑ lag>120초 ∧ 종착 상태는 동결 레코드 — null(판정 불가)로 강등.
 * 미제공·파싱 불가도 null(소비자 행동이 같아 구분하지 않는다 — 표기 생략).
 */
export function subwayDataAgeSeconds(
  receivedAt: string | undefined,
  arrivalCode: string | undefined,
  nowMs: number,
): number | null {
  if (!receivedAt) return null;
  const t = parseRecptnDt(receivedAt);
  if (t == null) return null;
  const lag = Math.max(0, Math.round((nowMs - t) / 1000));
  if (lag > STALE_FROZEN_SECONDS && arrivalCode != null && TERMINAL_ARVL_CODES.has(arrivalCode)) {
    return null;
  }
  return lag;
}

/**
 * 승강장 정차 상한(초, A74 잠정 — 실승차 판정 대상). 위치가 움직였다는 증거 없이 「도착」이 이보다 오래됐으면
 * 그 열차는 떠난 것으로 본다. 실측 2026-11-17(spec `2026-11-17-a74-departed-train-at-board-stop-design.md` §1):
 * 수인분당선 도착 피드는 열차가 떠난 뒤에도 「도착」을 194초까지 유지했고, 2호선 교대의 실제 정차는 96초였다.
 * 그래서 문턱은 넉넉히 두고(문이 열린 열차를 떠났다고 하지 않는다), 그보다 이른 몫은 위치 이동과
 * 클라이언트의 확인 요청이 받는다.
 */
export const PLATFORM_DWELL_SECONDS = 120;

/** 위치 조회 예산(ms) — 도착 폴 안에 직렬로 끼므로 짧게 자르고, 넘기면 위치 없이 판정한다. */
const BOARD_STOP_POSITION_BUDGET_MS = 1_500;

export interface BoardStopDeparture {
  /** 조회 역에 「도착」으로 실렸지만 이미 떠난 것으로 판정. */
  departed: boolean;
  /** 그 역 승강장에 선 뒤 지난 시간(초). 알 수 없으면 null. */
  platformAgeSeconds: number | null;
}

/**
 * 조회 역에 「도착」(arvlCd 1)으로 실린 열차가 이미 떠났는가(A74, spec §3). 순수 판정.
 *
 * 떠남의 증거는 둘이다. ①위치가 움직였다: 위치 행이 도착 레코드보다 **나중에** 수신됐고 다른 역을 말하거나,
 * 같은 역에서 출발(2)을 말한다. 더 오래된 위치(캐시·피드 지연)는 증거가 아니다 — 막 도착한 열차를 떠났다고
 * 하게 된다. ②움직임을 모르면 승강장 나이(두 피드 중 큰 값)가 `PLATFORM_DWELL_SECONDS`를 넘는다.
 *
 * ⚠ 위치 행은 **이 한 가지 판정에만** 쓴다 — 조인은 열차 번호, 비교는 역 이름·상태·수신 시각뿐이고
 * 방향 코드·정거장 순번은 쓰지 않는다(판정서 2026-08-23 §3이 기각한 "위치로 추적 대체"가 아니다).
 * 결과는 승격을 막는 쪽으로만 쓰인다.
 */
export function boardStopDeparture(input: {
  station: string;
  /** 같은 도착 레코드의 현재 위치(`arvlMsg3`) — 조회 역의 또 다른 표기라 역 이름 비교에 함께 쓴다. */
  currentLocation?: string | null;
  receivedAt: string | undefined;
  position: SubwayTrainPosition | null;
  nowMs: number;
}): BoardStopDeparture {
  const timeOf = (raw: string | undefined): number | null => (raw ? parseRecptnDt(raw) : null);
  const ageOf = (t: number | null): number | null =>
    t == null ? null : Math.max(0, Math.round((input.nowMs - t) / 1000));
  const arrivalAt = timeOf(input.receivedAt);
  const arrivalAge = ageOf(arrivalAt);
  const pos = input.position;
  const posAt = pos ? timeOf(pos.receivedAt) : null;
  const posStation = pos ? normalizeStationName(pos.station) : null;
  const sameStation =
    posStation != null &&
    (posStation === normalizeStationName(input.station) ||
      (!!input.currentLocation && posStation === normalizeStationName(input.currentLocation)));
  if (pos) {
    if (sameStation && pos.trainStatus === "2") return { departed: true, platformAgeSeconds: arrivalAge };
    if (!sameStation && posAt != null && arrivalAt != null && posAt > arrivalAt) {
      return { departed: true, platformAgeSeconds: arrivalAge };
    }
  }
  const positionAge = pos && sameStation && pos.trainStatus === "1" ? ageOf(posAt) : null;
  const platformAge =
    arrivalAge == null && positionAge == null ? null : Math.max(arrivalAge ?? 0, positionAge ?? 0);
  return {
    departed: platformAge != null && platformAge > PLATFORM_DWELL_SECONDS,
    platformAgeSeconds: platformAge,
  };
}

/**
 * 위치 목록은 **새 클라이언트의 승차역 폴**(`departCheck`)이고, 위치가 판정을 바꿀 수 있는 「도착」 항목
 * (레코드 나이가 아직 문턱 이하)이 있을 때만 받는다 — 하차역 폴과 옛 클라이언트는 위치를 조회하지 않는다
 * (실시간 키 일 1,000회를 도착과 나눈다). 실패·예산 초과·키 없음은 빈 맵(추적을 실패시키지 않는다).
 * 같은 열차 번호가 둘 이상이면 수신 시각이 가장 새로운 행을 쓴다.
 */
async function boardStopPositions(
  line: string,
  arrivals: { trainNo?: string; arrivalCode?: string; receivedAt?: string }[],
  nowMs: number,
): Promise<Map<string, SubwayTrainPosition>> {
  const out = new Map<string, SubwayTrainPosition>();
  const undecided = arrivals.some((a) => {
    if (a.arrivalCode !== "1" || !a.trainNo) return false;
    const t = a.receivedAt ? parseRecptnDt(a.receivedAt) : null;
    return t == null || (nowMs - t) / 1000 <= PLATFORM_DWELL_SECONDS;
  });
  if (!undecided) return out;
  try {
    const positions = await Promise.race([
      fetchSubwayLinePositions(line, nowMs),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BOARD_STOP_POSITION_BUDGET_MS)),
    ]);
    for (const t of positions?.trains ?? []) {
      const prev = out.get(t.trainNo);
      const at = (row: SubwayTrainPosition) => (row.receivedAt ? parseRecptnDt(row.receivedAt) : null) ?? 0;
      if (!prev || at(t) > at(prev)) out.set(t.trainNo, t);
    }
  } catch {
    // 위치 조회 실패는 판정 재료가 하나 줄 뿐이다 — 도착 레코드 나이만으로 가른다.
  }
  return out;
}

/**
 * 승차 대기·하차 카운트다운 공용: 역 도착조회를 노선(ODsay lineName → subwayId
 * 매핑표)으로 필터. 미커버 노선(비수도권)·미커버 역은 unsupported.
 */
export async function trackSubway(params: {
  station: string;
  lineName: string;
  lang: DataLang;
  /** 승차역 폴(대기·승차 국면)이 싣는 옵트인(A74) — 떠난 열차 판정에 위치 목록을 쓴다. 미지정이면 레코드 나이만. */
  departCheck?: boolean;
}): Promise<TransitTrackResult> {
  const subwayId = subwayIdForOdsayLine(params.lineName);
  const expectedLine = subwayId ? subwayLineNameForId(subwayId) : undefined;
  if (!expectedLine) return { status: "unsupported" };
  // 영문은 E27의 행렬(`enrichArrivalEn`)을 **그대로 태운다** — 여기서 별도 생성기를 만들면
  // 같은 도착 코드가 역 상세와 안내에서 서로 다른 문장을 내게 된다.
  const result = params.lang === "en"
    ? withArrivalsEn(await fetchSubwayArrivals(params.station))
    : await fetchSubwayArrivals(params.station);
  // null(INFO-200)은 "미커버"와 "접근 열차 없음(운행 밖 포함)"이 같은 코드를
  // 쓴다(지하철 4-state 교훈). 추적에선 노선 매핑표가 수도권 커버를 이미
  // 걸렀으므로 empty(미등장)가 정직하다 — 심야 실호출에서 unsupported로
  // 뭉개져 "신호 끊김"으로 오통지되는 것을 확인(2026-08-04).
  if (result === null) return { status: "empty", rawCount: 0 };
  const now = Date.now();
  const lineArrivals = result.arrivals
    .filter((a) => a.line === expectedLine)
    // 코드는 문장과 맞춘 뒤에만 싣는다(`reconcileArvlCd`) — 상태 기계의 승차·도착 판정이 이 코드를 읽는다.
    .map((a) => ({ ...a, arrivalCode: reconcileArvlCd(a.message, a.arrivalCode) ?? undefined }));
  // A74: 「도착」으로 실린 열차가 이미 떠났는지 가른다. arvlCd·message는 건드리지 않는다 — 같은 응답을
  // 하차역 폴도 읽고, 거기서는 코드 1이 도착 확정의 유일한 근거다.
  const positions = params.departCheck
    ? await boardStopPositions(expectedLine, lineArrivals, now)
    : new Map<string, SubwayTrainPosition>();
  const items = lineArrivals
    .map((a) => ({
      a,
      departure:
        a.arrivalCode === "1"
          ? boardStopDeparture({
              station: params.station,
              currentLocation: a.currentLocation,
              receivedAt: a.receivedAt,
              position: (a.trainNo ? positions.get(a.trainNo) : undefined) ?? null,
              nowMs: now,
            })
          : null,
    }))
    .map(
      ({ a, departure }): TrackItem => ({
        vehicleId: a.trainNo ?? null,
        direction: a.direction,
        message: a.message,
        remainingStops: remainingFromArvlMsg(a.message) ?? remainingFromArvlCd(a.arrivalCode),
        destinationName: a.destination || null,
        express: a.express,
        arrivalCode: a.arrivalCode ?? null,
        currentLocation: a.currentLocation || null,
        dataStamp: a.receivedAt ?? null,
        // 스토어판 보호(A74): 떠난 열차의 승강장 나이가 옛 클라이언트의 신선도 상한을 넘으면 그 나이를 싣는다 —
        // 종전엔 동결 판정이 null로 내려 리듀서가 "신선"으로 읽었다. 상한 이하는 값을 부풀리지 않는다.
        dataAgeSeconds:
          departure?.departed && (departure.platformAgeSeconds ?? 0) > STALE_FROZEN_SECONDS
            ? departure.platformAgeSeconds
            : subwayDataAgeSeconds(a.receivedAt, a.arrivalCode, now),
        ...(departure?.departed ? { departedLikely: true } : {}),
        ...(departure?.platformAgeSeconds != null ? { platformAgeSeconds: departure.platformAgeSeconds } : {}),
        // 영문 조각(spec §3.2). `""`는 정보 소실이라 실지 않는다 — `nonEmpty`가 그 정규화다.
        // 종착역은 `trainLineNmEn`("To X via Y" 문장)에서 뗄 수 없어 seed 영문을 직접 조회한다.
        ...(params.lang === "en"
          ? {
              ...englishFieldOnly("messageEn", a.messageEn),
              ...englishFieldOnly("directionEn", a.directionEn),
              ...englishFieldOnly(
                "destinationNameEn",
                a.destination ? (stationNameEn(SUBWAY_EN_CTX, a.destination, a.line) ?? undefined) : undefined,
              ),
              ...englishFieldOnly("currentLocationEn", a.currentLocationEn),
            }
          : {}),
      }),
    );
  return withItems(items, result.arrivals.length);
}
