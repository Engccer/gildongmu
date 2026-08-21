import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear } from "./providers/surroundings";
import { findKidsPlacesNear } from "./providers/kids-places";
import { searchBarrierFreeNearby } from "./providers/tour-barrier-free";
import { findEventsNear, isEventServiceArea } from "./culture-events";
import { fetchNearbyBusStops, isUncoveredBusRegion } from "./bus";
import { findStationsNear } from "./subway-stations";
import { stripRegionPrefix } from "./where-am-i";
import { hasDataGoKrKey, hasKakaoKey, hasSeoulOpenDataKey } from "./env";
import { bearingDegrees, bearingToCompass8, type CompassDirection } from "./geo/bearing";

/**
 * M4 "한눈에 보기" — 현재 위치 주변 5종(대중교통·식당과 카페·아이 놀 곳·문화 행사·
 * 무장애 관광지)을 **공통 반경 1km**로 한 번에 집계한다. 설계 정본
 * `docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md` §3·§5·§6.
 *
 * 서버는 구조화 데이터(개수·가까운 곳 2개·상태)만 내고 문장은 소비자(Kit·CLI)의
 * 결정론 템플릿이 조립한다(`assembleWhereAmI` 관례, LLM 아님).
 *
 * 불변식(불릿별 독립 3-state): 조각 rejected → `failed`, 빈 결과 → `none`, 키 없음 →
 * 불릿 **부재**(게이트 패턴: 0 노출), 국내 미제공 → `unavailable`. 한 조각의 실패가
 * 다른 불릿을 건드리지 않는다. 반경은 **한 상수**다 — 불릿마다 다른 "가까운"을 쓰면
 * 조망만 듣는 SR 사용자에게 브리핑이 거짓이 된다(research §3.1).
 */

/** 공통 반경. 실호출 판정(spec §5): 서울 주거·상권·업무 전부에서 희소 도메인 둘(아이 놀 곳·무장애)이 비0이 되는 최소값. */
export const OVERVIEW_RADIUS_M = 1000;
/** 불릿당 이름을 부르는 "가장 가까운 곳" 수(위원장 판정 2026-08-22). */
export const OVERVIEW_NEAREST_CAP = 2;
/** 식당·카페 조각의 상류 캡(카카오 카테고리 2종 × size 15). 이 값이면 "N곳 이상"으로 말한다. */
const FOOD_UPSTREAM_CAP = 30;

export type OverviewKind = "transit" | "food" | "kids" | "events" | "barrierFree";
type PlaceKind = Exclude<OverviewKind, "transit">;

export interface OverviewPlace {
  name: string;
  distanceMeters: number;
  bearing: CompassDirection;
}

export interface OverviewStation {
  name: string;
  line?: string;
  bearing: CompassDirection;
  distanceMeters: number;
}

export type OverviewBusStops =
  | { state: "ok"; count: number; nearest: OverviewPlace[] }
  | { state: "none" }
  | { state: "uncovered" }
  | { state: "failed" };

export type OverviewBullet =
  | {
      kind: "transit";
      state: "ok";
      station: OverviewStation | null;
      /** null = 버스 키 없음(조각 생략). */
      busStops: OverviewBusStops | null;
    }
  | { kind: PlaceKind; state: "ok"; count: number; countCapped: boolean; nearest: OverviewPlace[] }
  | { kind: PlaceKind; state: "none" }
  | { kind: "events"; state: "unavailable"; reason: "seoulOnly" }
  | { kind: PlaceKind; state: "failed" };

export interface NearbyOverview {
  /** 위치 문장 재료(행정동 + 도로명, 접두 중복 제거). 못 얻으면 null. */
  place: string | null;
  radiusMeters: number;
  /** 순서 고정: transit, food, kids, events, barrierFree. 키 없는 불릿은 없다. */
  bullets: OverviewBullet[];
}

/** 조각이 공통으로 갖는 최소 모양 — 도메인 타입(SurroundingPlace·KidsPlace·BusStop…)이 구조적으로 만족한다. */
export interface Located {
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

/** `composeOverview` 입력. null 조각 = 키 없음(게이트), "unavailable" = 국내 미제공 선판정. */
export interface OverviewInput {
  lat: number;
  lng: number;
  address: { road: string | null; jibun: string | null } | null;
  region: string | null;
  station: (Located & { lineName: string }) | null;
  bus: PromiseSettledResult<Located[]> | null;
  /** bus가 0건일 때만 의미 있다(`isUncoveredBusRegion`). */
  busUncovered: boolean;
  food: PromiseSettledResult<Located[]> | null;
  kids: PromiseSettledResult<Located[]> | null;
  /** total은 캡 전 수(`NearbyEventsResult.total`). */
  events: PromiseSettledResult<{ events: Located[]; total: number }> | "unavailable" | null;
  barrierFree: PromiseSettledResult<Located[]> | null;
}

function toNearest(origin: { lat: number; lng: number }, items: Located[]): OverviewPlace[] {
  return [...items]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, OVERVIEW_NEAREST_CAP)
    .map((p) => ({
      name: p.name,
      distanceMeters: Math.round(p.distanceMeters),
      bearing: bearingToCompass8(bearingDegrees(origin.lat, origin.lng, p.lat, p.lng)),
    }));
}

function placeBullet(
  kind: PlaceKind,
  origin: { lat: number; lng: number },
  settled: PromiseSettledResult<Located[]>,
  count: number,
  countCapped: boolean,
): OverviewBullet {
  if (settled.status === "rejected") return { kind, state: "failed" };
  if (count === 0) return { kind, state: "none" };
  return { kind, state: "ok", count, countCapped, nearest: toNearest(origin, settled.value) };
}

/** 순수: 조각 결과 → 불릿. I/O 없음(테스트 정본). */
export function composeOverview(input: OverviewInput): NearbyOverview {
  const origin = { lat: input.lat, lng: input.lng };

  const rawRoad = input.address?.road || input.address?.jibun || null;
  const road = rawRoad ? stripRegionPrefix(input.region, rawRoad) : null;
  const parts = [input.region, road].filter((s): s is string => Boolean(s));
  const place = parts.length > 0 ? parts.join(", ") : null;

  const station: OverviewStation | null = input.station
    ? {
        name: input.station.name,
        line: input.station.lineName || undefined,
        bearing: bearingToCompass8(
          bearingDegrees(origin.lat, origin.lng, input.station.lat, input.station.lng),
        ),
        distanceMeters: Math.round(input.station.distanceMeters),
      }
    : null;

  let busStops: OverviewBusStops | null = null;
  if (input.bus) {
    if (input.bus.status === "rejected") busStops = { state: "failed" };
    else if (input.bus.value.length === 0)
      busStops = input.busUncovered ? { state: "uncovered" } : { state: "none" };
    else
      busStops = {
        state: "ok",
        count: input.bus.value.length,
        nearest: toNearest(origin, input.bus.value),
      };
  }

  const bullets: OverviewBullet[] = [{ kind: "transit", state: "ok", station, busStops }];

  if (input.food) {
    const n = input.food.status === "fulfilled" ? input.food.value.length : 0;
    bullets.push(placeBullet("food", origin, input.food, n, n >= FOOD_UPSTREAM_CAP));
  }
  if (input.kids) {
    const n = input.kids.status === "fulfilled" ? input.kids.value.length : 0;
    bullets.push(placeBullet("kids", origin, input.kids, n, false));
  }
  if (input.events === "unavailable") {
    bullets.push({ kind: "events", state: "unavailable", reason: "seoulOnly" });
  } else if (input.events) {
    const settled: PromiseSettledResult<Located[]> =
      input.events.status === "fulfilled"
        ? { status: "fulfilled", value: input.events.value.events }
        : input.events;
    const n = input.events.status === "fulfilled" ? input.events.value.total : 0;
    bullets.push(placeBullet("events", origin, settled, n, false));
  }
  if (input.barrierFree) {
    const n = input.barrierFree.status === "fulfilled" ? input.barrierFree.value.length : 0;
    bullets.push(placeBullet("barrierFree", origin, input.barrierFree, n, false));
  }

  return { place, radiusMeters: OVERVIEW_RADIUS_M, bullets };
}

async function settle<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  return (await Promise.allSettled([p]))[0];
}

/**
 * I/O: 좌표 → 조각 병렬 조회 → `composeOverview`. 키 게이트는 여기서 조각을 null로
 * 둔다(라우트는 게이트를 모른다). 역은 seed 동기 조회라 실패 경로가 없다.
 */
export async function assembleNearbyOverview(lat: number, lng: number): Promise<NearbyOverview> {
  const kakao = hasKakaoKey();
  const dataGoKr = hasDataGoKrKey();
  const seoul = hasSeoulOpenDataKey();
  const radius = { radiusMeters: OVERVIEW_RADIUS_M };

  const [addr, region, bus, food, kids, events, barrierFree] = await Promise.all([
    kakao ? coordToAddress({ lat, lng }).catch(() => null) : Promise.resolve(null),
    kakao ? coordToRegion({ lat, lng }).catch(() => null) : Promise.resolve(null),
    dataGoKr ? settle(fetchNearbyBusStops(lat, lng)) : Promise.resolve(null),
    kakao
      ? settle(findSurroundingsNear(lat, lng, { groups: ["FD6", "CE7"], ...radius, cap: 50 }))
      : Promise.resolve(null),
    kakao ? settle(findKidsPlacesNear(lat, lng, radius)) : Promise.resolve(null),
    !seoul
      ? Promise.resolve(null)
      : !isEventServiceArea(lat, lng)
        ? Promise.resolve("unavailable" as const)
        : settle(
            findEventsNear(lat, lng, radius).then((r) => ({
              events: r.events.map((e) => ({ ...e, name: e.title })),
              total: r.total,
            })),
          ),
    dataGoKr
      ? settle(searchBarrierFreeNearby(lat, lng, { ...radius, limit: 50 }))
      : Promise.resolve(null),
  ]);

  // 미커버 판정은 0건일 때만(bus.ts 계약 — 좌표 선판정 금지).
  const busUncovered =
    bus?.status === "fulfilled" && bus.value.length === 0
      ? await isUncoveredBusRegion(lat, lng)
      : false;

  const station =
    findStationsNear(lat, lng, { ...radius, dedupeByName: true, limit: 1 })[0] ?? null;

  return composeOverview({
    lat,
    lng,
    address:
      addr && (addr.roadAddress || addr.jibunAddress)
        ? { road: addr.roadAddress ?? null, jibun: addr.jibunAddress ?? null }
        : null,
    region,
    station,
    bus,
    busUncovered,
    food,
    kids,
    events,
    barrierFree,
  });
}
