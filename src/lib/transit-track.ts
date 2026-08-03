import type { TrackItem } from "./transit-guide";
import { subwayIdForOdsayLine } from "./transit-guide";
import type { BusRouteStop, BusStop } from "./types";
import {
  fetchSeoulRideSlots,
  fetchSeoulRouteStops,
  fetchSeoulWaitSlots,
  type SeoulTrackSlot,
} from "./providers/seoul-bus";
import { fetchTagoArrivals, fetchTagoStopsNear } from "./providers/tago-bus";
import {
  fetchSubwayArrivals,
  subwayLineNameForId,
} from "./providers/seoul-subway-arrival";

/**
 * 대중교통 추적 폴링 서비스(B2 §7) — provider 봉투 차이를 여기서 흡수해
 * `/api/transit/track`이 판별 union만 내려보내게 한다(클라는 봉투를 모른다).
 *
 * 3-state 규율: 미등장(empty)·추적 불가(unsupported)·upstream 오류(throw→502)를
 * 절대 뭉개지 않는다. TrackItem은 상태 머신(transit-guide)과 같은 형태다.
 */

export type TransitTrackResult =
  | { status: "ok"; items: TrackItem[] }
  | { status: "empty" }
  | { status: "unsupported" };

function withItems(items: TrackItem[]): TransitTrackResult {
  return items.length > 0 ? { status: "ok", items } : { status: "empty" };
}

// === 서울 버스 ===

function slotToItem(slot: SeoulTrackSlot): TrackItem {
  return {
    vehicleId: slot.vehicleId,
    direction: "",
    message: slot.message,
    remainingStops: slot.remainingStops,
    destinationName: null,
    express: false,
    arrivalCode: null,
  };
}

/** 승차 대기: 승차 정류소(arsId)의 그 노선 도착 슬롯(vehId 보존 — 잠금 선택지). */
export async function trackSeoulWait(params: {
  arsId: string;
  routeId: string;
}): Promise<TransitTrackResult> {
  const slots = await fetchSeoulWaitSlots(params.arsId, params.routeId);
  return withItems(slots.map(slotToItem));
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
}): Promise<TransitTrackResult> {
  const { routeId, boardLocalId, alightLocalId } = params;
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
  return withItems(slots.map(slotToItem));
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
      }),
    );
  return withItems(items);
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
 * 승차 대기·하차 카운트다운 공용: 역 도착조회를 노선(ODsay lineName → subwayId
 * 매핑표)으로 필터. 미커버 노선(비수도권)·미커버 역은 unsupported.
 */
export async function trackSubway(params: {
  station: string;
  lineName: string;
}): Promise<TransitTrackResult> {
  const subwayId = subwayIdForOdsayLine(params.lineName);
  const expectedLine = subwayId ? subwayLineNameForId(subwayId) : undefined;
  if (!expectedLine) return { status: "unsupported" };
  const result = await fetchSubwayArrivals(params.station);
  // null(INFO-200)은 "미커버"와 "접근 열차 없음(운행 밖 포함)"이 같은 코드를
  // 쓴다(지하철 4-state 교훈). 추적에선 노선 매핑표가 수도권 커버를 이미
  // 걸렀으므로 empty(미등장)가 정직하다 — 심야 실호출에서 unsupported로
  // 뭉개져 "신호 끊김"으로 오통지되는 것을 확인(2026-08-04).
  if (result === null) return { status: "empty" };
  const items = result.arrivals
    .filter((a) => a.line === expectedLine)
    .map(
      (a): TrackItem => ({
        vehicleId: a.trainNo ?? null,
        direction: a.direction,
        message: a.message,
        remainingStops: remainingFromArvlMsg(a.message),
        destinationName: a.destination || null,
        express: a.express,
        arrivalCode: a.arrivalCode ?? null,
      }),
    );
  return withItems(items);
}
