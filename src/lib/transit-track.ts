import type { TrackItem } from "./transit-guide";
import { subwayIdForOdsayLine } from "./transit-guide";
import type { BusRouteStop, BusStop } from "./types";
import {
  ARRMSG_REMAINING_TAIL,
  fetchSeoulRideSlots,
  fetchSeoulRouteStops,
  fetchSeoulWaitSlots,
  type SeoulTrackSlot,
} from "./providers/seoul-bus";
import { fetchTagoArrivals, fetchTagoStopsNear } from "./providers/tago-bus";
import {
  fetchSubwayArrivals,
  subwayLineNameForId,
  withArrivalsEn,
} from "./providers/seoul-subway-arrival";
import { busArrivalMessageEnFrom } from "./bus-arrival-en";
import { stationNameEn } from "./subway-arrival-en";
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
 * 영문 조각 한 칸 — **빈 문자열은 싣지 않는다**(spec §3.4 ⚠). 이름·방향·종착역의 `""`는
 * "이 자리는 비어도 된다"가 아니라 정보 소실이라, 그대로 두면 줄 원자성 판정이 "완비"로
 * 읽어 `Boarded . Get off at .` 같은 줄을 만든다. `messageEn`의 `""`(TAGO)만 예외이고
 * 그 자리는 이 헬퍼를 지나지 않는다.
 */
function nonEmpty(key: string, value: string | undefined): Record<string, string> {
  return value != null && value.trim() !== "" ? { [key]: value } : {};
}

// === 서울 버스 ===

/**
 * **승차 국면** 도착 문장 정리 — 잔여 꼬리 `[N번째 전]`을 떼고 `…후`를 `… 남음`으로 맺는다.
 *
 * 승차 중 상태줄이 `transitGuide.remainingCount`("남은 정거장 N개")를 이미 말하므로
 * 원문을 그대로 실으면 한 문장 안에서 같은 수를 두 번 듣는다(실승차 피드백 2026-08-16 —
 * "…까지, 2분55초후[3번째 전]"). 다듬는 것은 **꼬리와 어미뿐**이고 상태 어휘
 * ("곧 도착"·"운행종료"·"출발대기")는 건드리지 않는다 — 완성 문장이 낭독 정본이라는
 * 계약(CLAUDE.md)은 그대로다.
 *
 * ⚠ **대기 국면에는 쓰지 않는다.** 같은 원문이 국면에 따라 다른 뜻이다 — 대기 중
 * "2분55초후"는 *버스가 여기 오기까지*이고 승차 중에는 *내릴 곳까지*라 어미가 갈린다.
 * 게다가 대기 후보 목록은 `remainingStops`를 별도로 싣지 않아(웹 `TransitGuidePanel`·
 * iOS `TransitTrackingSheet` 모두 `item.message`만 조립) **그 꼬리가 "몇 정거장 전에
 * 있는 버스인가"의 유일한 채널**이다. 국면 구분 없이 걸었다가 리뷰에서 잡혔다.
 *
 * ⚠ **`remainingStops` 추출보다 뒤에 와야 한다.** provider가 구조 필드
 * (`staOrd − sectOrd`)를 우선 쓰고 대괄호는 그 폴백이라(`remainingFromArrmsg`),
 * 순서를 뒤집으면 폴백 경로가 조용히 죽어 사다리 통지가 사라진다. 꼬리 패턴을 그
 * 추출 함수와 **공유**하는 것도 같은 이유다 — 한쪽만 읽는 형태가 생기면 잔여 수와
 * 문장이 동시에 사라진다.
 */
export function rewriteBusArrivalMessage(message: string): string {
  const withoutTail = message.replace(ARRMSG_REMAINING_TAIL, "").trim();
  return withoutTail.replace(/(\d(?:분|초))후$/, "$1 남음");
}

/**
 * 슬롯 → 추적 항목. **국면 인자는 필수다** — 같은 원문이 국면에 따라 다른 뜻이라
 * 문장도 달라야 한다(`rewriteBusArrivalMessage` 주석). 기본값을 두면 신규 호출부가
 * 국면을 빠뜨려도 컴파일이 통과해 조용히 틀린 문장을 낸다([[no-default-for-safety-parameters]]).
 */
function slotToItem(slot: SeoulTrackSlot, phase: "wait" | "ride", lang: DataLang): TrackItem {
  // 영문은 **원문**에서 만든다 — ko 재작성본("2분55초 남음")을 다시 파싱하면 두 해석이 갈린다.
  const messageEn = lang === "en" ? busArrivalMessageEnFrom(slot.message, phase) : undefined;
  return {
    vehicleId: slot.vehicleId,
    direction: "",
    message: phase === "ride" ? rewriteBusArrivalMessage(slot.message) : slot.message,
    remainingStops: slot.remainingStops,
    destinationName: null,
    express: false,
    arrivalCode: null,
    // 방향·종착역은 서울버스에 **구조적으로 없다**(ko도 ""·null) — 영문 자리도 만들지 않는다.
    ...(messageEn ? { messageEn } : {}),
  };
}

/** 승차 대기: 승차 정류소(arsId)의 그 노선 도착 슬롯(vehId 보존 — 잠금 선택지). */
export async function trackSeoulWait(params: {
  arsId: string;
  routeId: string;
  lang: DataLang;
}): Promise<TransitTrackResult> {
  const { slots, rawCount } = await fetchSeoulWaitSlots(params.arsId, params.routeId);
  return withItems(
    slots.map((s) => slotToItem(s, "wait", params.lang)),
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
    slots.map((s) => slotToItem(s, "ride", lang)),
    slots.length,
  );
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

/** 대기·카운트다운 공용(같은 도착 API): 그 정류소의 노선 번호 일치 도착만. */
export async function trackTago(params: {
  cityCode: string;
  nodeId: string;
  routeNo: string;
  lang: DataLang;
}): Promise<TransitTrackResult> {
  const arrivals = await fetchTagoArrivals(params.cityCode, params.nodeId);
  const items = arrivals
    .filter((a) => a.routeNo === params.routeNo)
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
      }),
    );
  return withItems(items, arrivals.length);
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
 * 승차 대기·하차 카운트다운 공용: 역 도착조회를 노선(ODsay lineName → subwayId
 * 매핑표)으로 필터. 미커버 노선(비수도권)·미커버 역은 unsupported.
 */
export async function trackSubway(params: {
  station: string;
  lineName: string;
  lang: DataLang;
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
  const items = result.arrivals
    .filter((a) => a.line === expectedLine)
    .map(
      (a): TrackItem => ({
        vehicleId: a.trainNo ?? null,
        direction: a.direction,
        message: a.message,
        remainingStops: remainingFromArvlMsg(a.message) ?? remainingFromArvlCd(a.arrivalCode),
        destinationName: a.destination || null,
        express: a.express,
        arrivalCode: a.arrivalCode ?? null,
        currentLocation: a.currentLocation || null,
        dataStamp: a.receivedAt ?? null,
        dataAgeSeconds: subwayDataAgeSeconds(a.receivedAt, a.arrivalCode, now),
        // 영문 조각(spec §3.2). `""`는 정보 소실이라 실지 않는다 — `nonEmpty`가 그 정규화다.
        // 종착역은 `trainLineNmEn`("To X via Y" 문장)에서 뗄 수 없어 seed 영문을 직접 조회한다.
        ...(params.lang === "en"
          ? {
              ...nonEmpty("messageEn", a.messageEn),
              ...nonEmpty("directionEn", a.directionEn),
              ...nonEmpty(
                "destinationNameEn",
                a.destination ? (stationNameEn(SUBWAY_EN_CTX, a.destination, a.line) ?? undefined) : undefined,
              ),
              ...nonEmpty("currentLocationEn", a.currentLocationEn),
            }
          : {}),
      }),
    );
  return withItems(items, result.arrivals.length);
}
