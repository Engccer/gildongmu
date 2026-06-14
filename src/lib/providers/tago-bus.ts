import type { BusArrival, BusRouteStop, BusStop } from "../types";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 시내버스 provider.
 *
 * 3종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유):
 * - A-2 BusSttnInfoInqireService/getCrdntPrxmtSttnList — 좌표 근접 정류소
 * - A-1 ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList — 정류소별 도착예정
 * - A-3 BusRouteInfoInqireService/getRouteAcctoThrghSttnList — 노선 경유정류소
 *
 * data.go.kr 표준 envelope(response.body.items.item, 빈결과 items:"")를
 * 코레일 편의시설과 동일하게 가정한다. 거리 정렬은 Haversine로 직접 계산한다
 * (A-2가 거리순을 보장하지 않으므로 — 산술은 코드의 책임).
 */

type RawItem = Record<string, unknown>;

/** data.go.kr 표준 envelope에서 item 배열을 안전 추출(코레일과 동일 규약). */
export function parseTagoItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item as RawItem[];
  if (item && typeof item === "object") return [item as RawItem];
  return [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 유한 실수 또는 NaN(파싱 불가 표식). */
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 음수·비유한 방어 후 반올림 정수(0 이상). */
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** 두 WGS84 좌표 간 대원거리(m). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/** A-2 응답 → 거리 오름차순 BusStop[](도착정보는 빈 배열로 시작). */
export function parseBusStops(
  raw: unknown,
  originLat: number,
  originLng: number,
): BusStop[] {
  return parseTagoItems(raw)
    .map((it): BusStop => {
      const lat = numF(it.gpslati);
      const lng = numF(it.gpslong);
      return {
        nodeId: str(it.nodeid),
        cityCode: str(it.citycode),
        name: str(it.nodenm),
        stopNo: it.nodeno != null && str(it.nodeno) !== "" ? str(it.nodeno) : undefined,
        lat,
        lng,
        distanceMeters: haversineMeters(originLat, originLng, lat, lng),
        arrivalStatus: "ok", // 기본값 — fetchNearbyBusStops가 A-1 결과로 ok/unavailable 확정
        arrivals: [],
      };
    })
    .filter((s) => s.nodeId && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** A-1 응답 → 도착 임박 순 BusArrival[]. */
export function parseBusArrivals(raw: unknown): BusArrival[] {
  return parseTagoItems(raw)
    .map((it): BusArrival => ({
      routeId: str(it.routeid),
      routeNo: str(it.routeno),
      routeType: str(it.routetp),
      arrivalSeconds: nonNegInt(it.arrtime),
      prevStationCount: nonNegInt(it.arrprevstationcnt),
      lowFloor: str(it.vehicletp).includes("저상"),
    }))
    .filter((a) => a.routeNo)
    .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
}

/** A-3 응답 → 순번 오름차순 BusRouteStop[]. */
export function parseBusRouteStops(raw: unknown): BusRouteStop[] {
  return parseTagoItems(raw)
    .map((it): BusRouteStop => ({
      nodeId: str(it.nodeid),
      name: str(it.nodenm),
      order: nonNegInt(it.nodeord),
      lat: numF(it.gpslati),
      lng: numF(it.gpslong),
    }))
    .filter((s) => s.nodeId)
    .sort((a, b) => a.order - b.order);
}
