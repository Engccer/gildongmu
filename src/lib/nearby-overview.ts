import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear } from "./providers/surroundings";
import { findKidsPlacesNear } from "./providers/kids-places";
import { searchBarrierFreeNearby } from "./providers/tour-barrier-free";
import { findEventsNear } from "./culture-events";
import { metersOutsideSeoul } from "./coverage";
import { fetchNearbyBusStops, isUncoveredBusRegion } from "./bus";
import { findStationsNear } from "./subway-stations";
import { stripRegionPrefix } from "./where-am-i";
import { hasDataGoKrKey, hasKakaoKey, hasSeoulOpenDataKey } from "./env";
import { bearingDegrees, bearingToCompass8, type CompassDirection } from "./geo/bearing";
import type { Place } from "./types";
import { barrierFreePlaceToPlace, kidsPlaceToPlace, surroundingPlaceToPlace } from "./nearby-place";

/**
 * M4 "한눈에 보기" — 현재 위치 주변 6종(대중교통·식당·카페·아이 놀 곳·문화 행사·
 * 무장애 관광지)을 **공통 반경 1km**로 한 번에 집계한다(식당·카페 분리는 위원장 2026-08-22). 설계 정본
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
/**
 * 불릿당 이름을 부르는 "가장 가까운 곳" 수 — 개수의 함수(계단식, 2026-08-24 spec §2.1).
 * 종전 고정 2곳은 식당 45곳 이상과 아이 놀 곳 3곳을 같은 수로 불러 비례성이 없었다(위원장 관찰).
 * 상한 4는 SR 브리핑 한 불릿의 길이 상한. 구간값(5·10)은 실사용 판정 항목(BACKLOG K4).
 */
export function overviewNearestCap(count: number): number {
  if (count >= 10) return 4;
  if (count >= 5) return 3;
  return 2;
}
/** 카카오 카테고리 검색 1종의 상류 캡(size 15). 이 값에 닿으면 "N곳 이상"으로 말한다. */
const KAKAO_CATEGORY_PAGE_CAP = 15;
const FOOD_GROUP = "FD6";
const CAFE_GROUP = "CE7";

export type OverviewKind = "transit" | "food" | "cafe" | "kids" | "events" | "barrierFree";
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

/** `composeOverview` 결과. `overview`는 wire 모양(라우트 응답·Kit·CLI 디코딩), `places`는
 *  채팅 카드용 장소 투영(불릿 순서 → 거리순, id dedupe) — wire에 싣지 않는다(spec 2026-08-24 §2.2). */
export interface ComposedOverview {
  overview: NearbyOverview;
  places: Place[];
}

export interface NearbyOverview {
  /** 위치 문장 재료(행정동 + 도로명, 접두 중복 제거). 못 얻으면 null. */
  place: string | null;
  radiusMeters: number;
  /** 순서 고정: transit, food, cafe, kids, events, barrierFree. 키 없는 불릿은 없다. */
  bullets: OverviewBullet[];
}

/** 조각이 공통으로 갖는 최소 모양 — 도메인 타입(SurroundingPlace·KidsPlace·BusStop…)이 구조적으로 만족한다. */
export interface Located {
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  /** 장소 상세가 있는 조각(식당·카페·아이·무장애)만. 채팅 카드 투영의 근거.
   *  (`place`가 아닌 이유: 문화행사 레코드의 `place: string`(장소명)과 충돌한다.) */
  projected?: Place;
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
  /** 식당(FD6). 상류 캡(15)에 닿으면 `capped` — 확정 수가 아니라 "N곳 이상"이다. */
  food: PromiseSettledResult<{ places: Located[]; capped: boolean }> | null;
  /** 카페(CE7). food와 같은 모양, 별도 불릿(식당·카페를 한 불릿으로 합치면 수가 합산돼 종별 질문에 답하지 못한다). */
  cafe: PromiseSettledResult<{ places: Located[]; capped: boolean }> | null;
  kids: PromiseSettledResult<Located[]> | null;
  /** total은 캡 전 수(`NearbyEventsResult.total`). */
  events: PromiseSettledResult<{ events: Located[]; total: number }> | "unavailable" | null;
  barrierFree: PromiseSettledResult<Located[]> | null;
}

/** 거리순 상위 `overviewNearestCap(count)`개. `count`는 불릿이 말하는 개수(행사는 total). */
function nearestItems(items: Located[], count: number): Located[] {
  return [...items]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, overviewNearestCap(count));
}

function toNearest(origin: { lat: number; lng: number }, items: Located[]): OverviewPlace[] {
  return items.map((p) => ({
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
  places: Place[],
): OverviewBullet {
  if (settled.status === "rejected") return { kind, state: "failed" };
  if (count === 0) return { kind, state: "none" };
  const items = nearestItems(settled.value, count);
  for (const it of items) if (it.projected) places.push(it.projected);
  return { kind, state: "ok", count, countCapped, nearest: toNearest(origin, items) };
}

/** 순수: 조각 결과 → 불릿. I/O 없음(테스트 정본). */
export function composeOverview(input: OverviewInput): ComposedOverview {
  const origin = { lat: input.lat, lng: input.lng };
  const places: Place[] = [];

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
        nearest: toNearest(origin, nearestItems(input.bus.value, input.bus.value.length)),
      };
  }

  const bullets: OverviewBullet[] = [{ kind: "transit", state: "ok", station, busStops }];

  for (const [kind, slice] of [["food", input.food], ["cafe", input.cafe]] as const) {
    if (!slice) continue;
    const settled: PromiseSettledResult<Located[]> =
      slice.status === "fulfilled" ? { status: "fulfilled", value: slice.value.places } : slice;
    const n = slice.status === "fulfilled" ? slice.value.places.length : 0;
    const capped = slice.status === "fulfilled" && slice.value.capped;
    bullets.push(placeBullet(kind, origin, settled, n, capped, places));
  }
  if (input.kids) {
    const n = input.kids.status === "fulfilled" ? input.kids.value.length : 0;
    bullets.push(placeBullet("kids", origin, input.kids, n, false, places));
  }
  if (input.events === "unavailable") {
    bullets.push({ kind: "events", state: "unavailable", reason: "seoulOnly" });
  } else if (input.events) {
    const settled: PromiseSettledResult<Located[]> =
      input.events.status === "fulfilled"
        ? { status: "fulfilled", value: input.events.value.events }
        : input.events;
    const n = input.events.status === "fulfilled" ? input.events.value.total : 0;
    bullets.push(placeBullet("events", origin, settled, n, false, places));
  }
  if (input.barrierFree) {
    const n = input.barrierFree.status === "fulfilled" ? input.barrierFree.value.length : 0;
    bullets.push(placeBullet("barrierFree", origin, input.barrierFree, n, false, places));
  }

  // 식당·카페 교집합(카카오 category_group이 둘 다인 가게) 대비 id dedupe — 첫 등장(불릿 순서) 유지.
  const seen = new Set<string>();
  const dedupedPlaces = places.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return { overview: { place, radiusMeters: OVERVIEW_RADIUS_M, bullets }, places: dedupedPlaces };
}

/** 카카오 카테고리 1종 조회. 상류 페이지 캡(15)에 닿으면 확정 수가 아니라 "N곳 이상"이다. */
async function fetchCategory(
  lat: number,
  lng: number,
  group: string,
): Promise<{ places: Located[]; capped: boolean }> {
  const found = await findSurroundingsNear(lat, lng, {
    groups: [group],
    radiusMeters: OVERVIEW_RADIUS_M,
    cap: 50,
  });
  const places = found.map((p) => ({ ...p, projected: surroundingPlaceToPlace(p) }));
  return { places, capped: places.length >= KAKAO_CATEGORY_PAGE_CAP };
}

async function settle<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  return (await Promise.allSettled([p]))[0];
}

/**
 * I/O: 좌표 → 조각 병렬 조회 → `composeOverview`. 키 게이트는 여기서 조각을 null로
 * 둔다(라우트는 게이트를 모른다). 역은 seed 동기 조회라 실패 경로가 없다.
 */
export async function assembleNearbyOverview(lat: number, lng: number): Promise<ComposedOverview> {
  const kakao = hasKakaoKey();
  const dataGoKr = hasDataGoKrKey();
  const seoul = hasSeoulOpenDataKey();
  const radius = { radiusMeters: OVERVIEW_RADIUS_M };

  const [addr, region, bus, food, cafe, kids, events, barrierFree] = await Promise.all([
    kakao ? coordToAddress({ lat, lng }).catch(() => null) : Promise.resolve(null),
    kakao ? coordToRegion({ lat, lng }).catch(() => null) : Promise.resolve(null),
    dataGoKr ? settle(fetchNearbyBusStops(lat, lng)) : Promise.resolve(null),
    kakao ? settle(fetchCategory(lat, lng, FOOD_GROUP)) : Promise.resolve(null),
    kakao ? settle(fetchCategory(lat, lng, CAFE_GROUP)) : Promise.resolve(null),
    kakao
      ? settle(findKidsPlacesNear(lat, lng, radius).then((ks) => ks.map((k) => ({ ...k, projected: kidsPlaceToPlace(k) }))))
      : Promise.resolve(null),
    // 국내 미제공 판정선은 이 조각의 조회 반경(1km)이다 — 문화행사 라우트의 3km와 다르다
    // (CLAUDE.md "판정선은 그 도메인의 조회 반경을 그대로 쓴다").
    !seoul
      ? Promise.resolve(null)
      : metersOutsideSeoul(lat, lng) > OVERVIEW_RADIUS_M
        ? Promise.resolve("unavailable" as const)
        : settle(
            findEventsNear(lat, lng, radius).then((r) => ({
              events: r.events.map((e) => ({ ...e, name: e.title })),
              total: r.total,
            })),
          ),
    dataGoKr
      ? settle(
          searchBarrierFreeNearby(lat, lng, { ...radius, limit: 50 }).then((bs) =>
            bs.map((b) => ({ ...b, projected: barrierFreePlaceToPlace(b) })),
          ),
        )
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
    cafe,
    kids,
    events,
    barrierFree,
  });
}
