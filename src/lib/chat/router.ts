/**
 * Gemini function call → provider 직접 호출 라우터. React/Next 비의존.
 * 각 도구는 provider를 직접 호출해 LLM용 data를 만들고, 카드 마운트 지시(render)와
 * 출처(source)를 함께 반환한다. 도구 내부 실패는 호출자(agent-loop)가 흡수한다.
 */
import type { ExecutionContext, RouteStartRenderPayload, ToolResult } from "./types";
import type { Place, PlaceSort } from "@/lib/types";
import {
  barrierFreePlaceToPlace,
  kidsPlaceToPlace,
  nightClinicToPlace,
  surroundingPlaceToPlace,
} from "@/lib/nearby-place";
import { searchPlaces } from "@/lib/providers/places";
import { searchJusoAddresses } from "@/lib/providers/juso-address";
import { findAirQualityNear } from "@/lib/providers/air-quality";
import { findWeatherNear } from "@/lib/providers/weather";
import {
  fetchNearbySubwayArrivals,
  findNearestStationInfo,
} from "@/lib/providers/subway-nearby";
import { fetchSubwayArrivals, withArrivalsEn } from "@/lib/providers/seoul-subway-arrival";
import { chatArrivalLines } from "./subway-arrival-lines";
import { fetchNearbyBusStops, isUncoveredBusRegion } from "@/lib/bus";
import {
  busRouteDeps,
  describeBusRoute,
  lookupBusRoute,
  normalizeRouteNo,
  summarizeBusLine,
  type BusRouteCandidate,
  type LocalSearch,
} from "@/lib/bus-route";
import { fetchNearbyBikeStations, isBikeServiceArea } from "@/lib/providers/seoul-bike";
import { findNightClinicsNow } from "@/lib/clinics";
import {
  findBarrierFreeByName,
  getBarrierFreeDetail,
  normalizeName,
  searchBarrierFreeNearby,
} from "@/lib/providers/tour-barrier-free";
import { fetchStationTimetable } from "@/lib/providers/tago-subway";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { findEventsNear, isEventServiceArea } from "@/lib/culture-events";
import { findCongestionNear } from "@/lib/congestion";
import { findStationMeta } from "@/lib/subway-stations";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";
import { getCarRoute } from "@/lib/car-route";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";
import { getTransitRoute } from "@/lib/providers/odsay";
import { getWalkRoute } from "@/lib/walk-route";
import { getWalkInfrastructure } from "@/lib/walk-infra";
import { searchWebPerplexity } from "./perplexity-search";
import { executePlanJourney } from "./journey-tool";
import { hasNcpMapsKeys, hasWalkRouteKey } from "@/lib/env";
import { placesToRender, placesToData, addressesToRender, addressesToData } from "./render";
import { overviewSources, sourceFor } from "./sources";
import { assembleWhereAmI } from "@/lib/where-am-i";
import { assembleNearbyOverview } from "@/lib/nearby-overview";
import { isInKorea } from "@/lib/coverage";
import { assembleScene } from "@/lib/surroundings-scene";
import { entranceSidesData } from "./entrance-sides";

/** 좌표 도구의 기준 좌표 — 장소 앵커 우선, 없으면 현재 위치. */
export function anchorOf(
  ctx: ExecutionContext,
): { lat: number; lng: number } | undefined {
  return ctx.placeAnchor ?? ctx.userLocation;
}

const OUT_OF_COVERAGE = {
  outOfCoverage: true,
  notice: "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.",
};

/** 좌표 도구 공통 커버리지 게이트 — 기준 좌표가 대한민국 밖이면 provider 미호출로 안내만 반환. */
function coverageGate(coord: { lat: number; lng: number } | undefined) {
  return coord && !isInKorea(coord.lat, coord.lng) ? { data: OUT_OF_COVERAGE } : null;
}


interface ResolvedCoord {
  lat: number;
  lng: number;
  /** 지명을 해석했을 때 실제로 고른 장소(이름·주소). 키워드 검색 1위라 사용자의 지명과 어긋날 수 있다. */
  resolvedPlace?: string;
  /** 고른 장소의 이름만(주소 없이). 결과에서 그 장소 자신을 가를 때 쓴다(E88 ⓒ). 모델 재료에 싣지 않는다. */
  resolvedName?: string;
}

/**
 * 지명 → 좌표(카카오 키워드 검색 첫 결과). 미지정이면 장소 앵커/현재 위치.
 * ⚠ 키워드 검색이라 "후쿠오카"가 대구의 동명 가게로 풀린 실측이 있다(2026-08-23) — 해석된
 * 장소를 `resolvedPlace`로 되돌려 LLM이 어긋남을 말할 수 있게 한다(조용한 대체 금지).
 */
async function resolveCoord(
  place: string | undefined,
  ctx: ExecutionContext,
): Promise<ResolvedCoord | undefined> {
  if (place) {
    const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
    const p = r.places[0];
    if (!p) return undefined;
    const addr = p.roadAddress || p.address;
    return { lat: p.lat, lng: p.lng, resolvedPlace: addr ? `${p.name} (${addr})` : p.name, resolvedName: p.name };
  }
  return anchorOf(ctx);
}

/**
 * 길찾기 경유지(K3 ⑤): 지명 → 좌표. 미지정이면 undefined, 해석 실패는 null(호출부가 error로 돌린다 —
 * 경유 없는 경로로 조용히 대체하면 "경유한 경로"가 거짓이 된다).
 */
async function resolveVia(
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<{ name: string; lat: number; lng: number } | null | undefined> {
  const via = args.via ? String(args.via) : undefined;
  if (!via) return undefined;
  const r = await searchPlaces({ query: via, lang: ctx.dataLocale });
  const p = r.places[0];
  return p ? { name: p.name, lat: p.lat, lng: p.lng } : null;
}

/**
 * 길찾기의 말한 출발지(E88 spec A1): 사용자가 현재 위치가 아닌 출발지를 말했을 때만 온다. 없으면 undefined.
 * 좌표는 `resolveCoord`가 풀고, 못 풀면 호출부가 `placeNotFound`로 돌린다(현재 위치로 대신하면 틀린 경로를 맞는 것처럼 답한다).
 */
function originArg(args: Record<string, unknown>): string | undefined {
  const origin = typeof args.origin === "string" ? args.origin.trim() : "";
  return origin || undefined;
}

/**
 * 말한 출발지가 한국 밖으로 풀렸을 때(E88 리뷰 S2). 종전 커버리지 안내는 「현재 위치」를 말해 사용자의 위치가 한국 밖이라고
 * 읽히고, 고른 장소가 없으면 키워드 검색이 엉뚱한 곳을 고른 사실을 모델이 말할 수 없다. 출발지를 말하지 않은 조회는 종전 게이트 그대로다.
 */
function originCoverageGate(named: ResolvedCoord | undefined, origin: { lat: number; lng: number }) {
  if (!named || isInKorea(named.lat, named.lng)) return coverageGate(origin);
  return {
    data: {
      outOfCoverage: true,
      origin: named.resolvedPlace,
      notice: "말한 출발지가 대한민국 밖의 장소로 잡혔습니다. 길찾기는 대한민국 안에서만 됩니다.",
    },
  };
}

/** 말한 출발지로 조회한 답에 싣는 조각 — 실제로 고른 장소(키워드 검색 첫 결과라 말한 곳과 다를 수 있다). */
function originNote(named: ResolvedCoord | undefined): { origin?: string } {
  return named ? { origin: named.resolvedPlace } : {};
}

/** 대중교통 수단 한정(E88 spec A2) — 도구 인자 `mode` → provider의 수단 축. 모르는 값은 한정 없음. */
const TRANSIT_MODE_AXIS = { subway: "subwayOnly", bus: "busOnly" } as const;

/**
 * 그 수단만으로 가는 경로가 없을 때. `route: null`만 주면 「경로 없음」으로 낭독돼 거짓이다.
 * ⚠ 다른 경로가 「있다」고 단정하지 않는다: provider의 null은 「수단 거르기 뒤 0건」과 「출발·도착이 너무 가까움(-98)」을 가르지 못한다(E88 리뷰 S1).
 */
const NO_ROUTE_WITH_MODE = {
  noRouteWithMode: true,
  notice: "이 수단만 타고 가는 경로를 찾지 못했습니다. 다른 수단을 섞으면 경로가 있을 수 있습니다(수단을 한정하지 않고 조회해야 알 수 있습니다).",
};

/** 경유지 미지원 마커(대중교통 전부, 자동차 en). `null`만 주면 "경로 없음"으로 낭독돼 거짓. */
const TRANSIT_WAYPOINT_UNSUPPORTED = {
  unsupported: "waypoint",
  notice: "이 길찾기는 경유지를 지원하지 않습니다. 경유지 없이 조회하거나 두 구간으로 나눠 물을 수 있습니다.",
};

/** 지명 조회 결과에 해석된 장소를 싣는 조각(지명 없는 조회엔 빈 객체). */
function placeNote(c: ResolvedCoord): { resolvedPlace?: string } {
  return c.resolvedPlace ? { resolvedPlace: c.resolvedPlace } : {};
}

/**
 * 서울 전용 데이터의 지역 밖 응답. `count: 0`을 그대로 넘기면 LLM이 "근처에 행사가
 * 없습니다"로 요약해 **데이터 출처의 한계가 지역의 부재로 위장**된다(부산 사용자가
 * "오늘 부산엔 행사가 없구나"로 읽는다). 판정 술어는 라우트와 같은 것을 쓴다.
 */
const SEOUL_ONLY = {
  unavailableHere: "seoulOnly",
  notice: "이 정보는 서울 지역만 제공됩니다. 다른 지역은 데이터 자체가 없으며, 근처에 없다는 뜻이 아닙니다.",
};

/**
 * TAGO가 그 지역 정류소를 아예 갖고 있지 않을 때. `count: 0`을 그대로 넘기면 LLM이
 * "근처에 정류소가 없습니다"로 요약하는데, 강릉처럼 터미널 앞에서도 0건인 지역에서
 * 그 문장은 거짓이다. ⚠ **0건일 때만 판정한다**(스펙 §2): 담양처럼 자기 도시코드가
 * 없어도 인접 광역시 버스가 잡히는 지역은 이 분기에 오지 않아야 한다.
 */
const NO_BUS_DATA = {
  unavailableHere: "noBusData",
  notice: "이 지역은 정류소 정보가 제공되지 않습니다. 정류소가 없다는 뜻이 아니라 데이터가 없다는 뜻입니다.",
};

/**
 * `get_bus_route`가 번호를 찾아본 범위(E87). 서울(TOPIS)은 늘 보고, 사용자 지역(TAGO)은 볼 수 있을 때만 본다 —
 * 못 본 지역을 「없다」로 접지 않게 범위를 문장으로 싣는다.
 */
const BUS_ROUTE_SEARCHED: Record<LocalSearch, string> = {
  seoul: "서울 버스(서울을 드나드는 수도권 노선 포함)에서 찾았습니다.",
  searched: "서울 버스와 기준 위치 지역의 버스에서 찾았습니다.",
  uncovered: "서울 버스에서만 찾았습니다. 기준 위치 지역은 버스 노선 정보가 제공되지 않습니다(노선이 없다는 뜻이 아닙니다).",
  unknown: "서울 버스에서만 찾았습니다. 기준 위치가 어느 지역인지 확인하지 못해 그 지역 버스는 찾아보지 못했습니다.",
  noLocation: "서울 버스에서만 찾았습니다. 현재 위치를 몰라 다른 지역 버스는 찾아보지 못했습니다(지역 이름을 알려 주면 찾을 수 있습니다).",
};

/**
 * 이름으로 찾은 무장애 정보가 없을 때(E88 spec B2). 「등록된 정보가 없음」이지 「편의시설이 없음」이 아니다 —
 * `detail: null`만 주면 모델이 시설이 없다고 답한다.
 */
const BARRIER_FREE_NOT_REGISTERED =
  "한국관광공사 무장애 여행 정보에 이 이름으로 등록된 곳을 찾지 못했습니다. 편의시설이 없다는 뜻이 아니라 등록된 정보가 없다는 뜻입니다.";

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };

/**
 * 장소 채팅에서 모델이 넘긴 장소 이름이 보고 있는 장소(앵커)인가(E88 ⓑ·ⓒ). 맞으면 이름을 다시 검색하지 않고 앵커 좌표를 쓴다 —
 * 다시 검색하면 다른 지점의 같은 이름으로 갈 수 있다. 비교는 공백·괄호·흔한 지점 접미를 뗀 보수적 동일성(`normalizeName`).
 */
function isAnchorName(named: string, anchor: ExecutionContext["placeAnchor"]): anchor is NonNullable<ExecutionContext["placeAnchor"]> {
  return !!anchor && normalizeName(named) === normalizeName(anchor.name);
}

/** 지명 해석 실패는 위치 부재가 아니다 — 같은 문장으로 답하면 사용자가 권한을 의심한다. */
function placeNotFound(place: string) {
  return { error: `'${place}' 위치를 찾지 못했습니다.` };
}

/**
 * 수단별로 호출부가 **반드시** 밝히는 칸(E83 spec §4) — 선택 인자·기본값이 없다. 빠뜨린 경유지·계단 회피·provider·결과가
 * 조용히 `null`·`false`로 접히면 카드가 다른 경로의 안내를 시작한다.
 */
type RouteStartFields =
  | { mode: "walk"; via: RouteStartRenderPayload["via"]; accessible: boolean }
  | { mode: "car"; via: RouteStartRenderPayload["via"]; carProvider: string | null }
  | { mode: "transit"; transit: NonNullable<RouteStartRenderPayload["transit"]> };

/**
 * 경로 안내 시작 카드 렌더(E83 spec §4). **모든 키가 늘 있다**(그 수단에 없는 값은 `null`·`false`): Kit 디코딩이 키 부재를
 * 실패로 읽는다.
 */
function routeStartRender(p: Place, fields: RouteStartFields): RouteStartRenderPayload {
  return {
    type: "route-start",
    mode: fields.mode,
    dest: { lat: p.lat, lng: p.lng },
    destLabel: p.name,
    destRoman: p.nameRoman ?? null,
    via: fields.mode === "transit" ? null : fields.via,
    accessible: fields.mode === "walk" ? fields.accessible : false,
    carProvider: fields.mode === "car" ? fields.carProvider : null,
    transit: fields.mode === "transit" ? fields.transit : null,
  };
}

/** 도구가 푼 경유지 → 렌더의 `via`(없으면 null). */
function routeStartVia(via: { name: string; lat: number; lng: number } | undefined): RouteStartRenderPayload["via"] {
  return via ? { lat: via.lat, lng: via.lng, label: via.name } : null;
}

/** get_walk_route가 LLM에 넘기는 steps 상한 — Tmap 도보 경로는 교차로마다
 * 안내 지점이 생겨 자동차·대중교통보다 단계 수가 훨씬 많다(토큰 방어). */
const WALK_STEPS_CAP = 20;

/** get_where_am_i가 LLM에 넘기는 주변 기준점 상한 — 정위 답엔 두세 곳이면 충분하다(토큰 방어). */
const WHERE_AM_I_LANDMARKS_CAP = 8;

export async function executeFunction(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const src = sourceFor(name, ctx);
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      // 장소 앵커 있으면 그 장소 기준, 없으면 현재 위치 — 다른 좌표 도구와 동일.
      // 좌표가 있으면 카카오가 거리순으로 정렬한다(없으면 정확도순).
      const anchor = anchorOf(ctx);
      // LLM 오값("rating" 등)은 서버 throw로 번지지 않게 정확도순으로 흡수한다 — declaration
      // enum이 "review" 하나뿐이라 정상 경로에선 여기 오지 않는다.
      // 네이버는 한국어 전용이라 비-ko 데이터 로케일에선 리뷰순 축이 死기능(웹 §4.3 동형) —
      // 정확도순으로 흡수한다.
      const sort: PlaceSort | undefined =
        args.sort === "review" && ctx.dataLocale === "ko" ? "review" : undefined;
      const result = await searchPlaces({
        query,
        lang: ctx.dataLocale,
        lat: anchor?.lat,
        lng: anchor?.lng,
        sort,
      });
      return { data: placesToData(result.places), render: placesToRender(result.places, sort), source: src };
    }
    case "search_address": {
      const keyword = String(args.keyword ?? "");
      const results = await searchJusoAddresses(keyword);
      return { data: addressesToData(results), render: addressesToRender(results), source: src };
    }
    case "get_subway_arrivals": {
      // 역명 조회(K3 ②): 이름 기반이라 좌표·커버리지 게이트를 타지 않는다(해외에서도 유효).
      // null=서울 도시철도 외·실시간 미제공 역 — 0건과 구분해 그대로 싣는다. 카드 없음(근접 카드는 기기 위치 self-fetch).
      // 열차마다 카드와 같은 두 줄(`chatArrivalLines`, A42)만 싣는다 — 원문·원재료 필드는 LLM에 가지 않는다.
      const stationName = args.stationName ? String(args.stationName) : undefined;
      if (stationName) {
        const raw = await fetchSubwayArrivals(stationName);
        const byName = ctx.dataLocale === "en" ? withArrivalsEn(raw) : raw;
        return {
          data: byName
            ? { stationName: byName.stationName, arrivals: chatArrivalLines(byName.arrivals, ctx.dataLocale) }
            : { stationName, arrivals: null },
          source: src,
        };
      }
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const stations = await fetchNearbySubwayArrivals(anchor.lat, anchor.lng, ctx.dataLocale);
      const arrivals = stations.map((s) => ({ ...s, arrivals: chatArrivalLines(s.arrivals, ctx.dataLocale) }));
      const render = placeMode ? undefined : ({ type: "subway-nearby" } as const);
      // 0건이면 최근접 역을 함께 넘긴다 — 거리 없이 "없다"고만 하면 LLM이 걸어갈
      // 만한 거리(1.5km)와 도시철도 없는 지역(90km)을 같은 문장으로 답한다.
      if (arrivals.length === 0) {
        const nearest = findNearestStationInfo(anchor.lat, anchor.lng);
        if (nearest) return { data: { ...placeNote(anchor), count: 0, arrivals, nearest }, render, source: src };
      }
      return { data: { ...placeNote(anchor), count: arrivals.length, arrivals }, render, source: src };
    }
    case "get_night_clinics": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      // openStatus를 서버가 계산해 넘긴다 — 진료시간 배열만 주면 LLM이 "지금
      // 진료중"을 스스로 추론(=날조)한다(현재 KST를 모른다). count는 병합 후
      // 전체 수라 "5곳뿐"으로 답하지 않는다. 각 항목의 designated(달빛 지정
      // 여부)와 supplementFailed(일반 소아과 보강 실패)도 산문에 쓸 수 있게 넘긴다.
      const { clinics, total, basis, supplementFailed } = await findNightClinicsNow(
        anchor.lat,
        anchor.lng,
      );
      // 렌더의 places는 LLM에 준 것과 같은 5건 — 산문에 나올 수 있는 장소만 근거로.
      const render = placeMode
        ? undefined
        : ({ type: "clinics-nearby", places: clinics.slice(0, 5).map(nightClinicToPlace) } as const);
      return {
        data: { ...placeNote(anchor), count: total, basis, supplementFailed, clinics: clinics.slice(0, 5) },
        render,
        source: src,
      };
    }
    case "get_nearby_barrier_free": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const places = await searchBarrierFreeNearby(anchor.lat, anchor.lng);
      const render = placeMode
        ? undefined
        : ({ type: "barrier-free-nearby", places: places.slice(0, 8).map(barrierFreePlaceToPlace) } as const);
      return { data: { ...placeNote(anchor), count: places.length, places: places.slice(0, 8) }, render, source: src };
    }
    case "get_kids_places": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const kids = await findKidsPlacesNear(anchor.lat, anchor.lng);
      const render = placeMode
        ? undefined
        : ({ type: "kids-nearby", places: kids.slice(0, 8).map(kidsPlaceToPlace) } as const);
      return { data: { ...placeNote(anchor), count: kids.length, places: kids.slice(0, 8) }, render, source: src };
    }
    case "get_nearby_events": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 서울 전용 데이터 — 서울 밖은 0건이 아니라 "정보 미보유"다(라우트와 같은 판정).
      if (!isEventServiceArea(anchor.lat, anchor.lng)) return { data: SEOUL_ONLY, source: src };
      // 카드 없이 산문이 정본 — 목록을 두 벌로 만들지 않는다(get_weather 동형).
      const { events, total } = await findEventsNear(anchor.lat, anchor.lng);
      return { data: { ...placeNote(anchor), count: total, events: events.slice(0, 8) }, source: src };
    }
    case "get_congestion": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // area:null은 오류가 아니라 "서울시가 혼잡도를 재는 121곳 밖"이다 —
      // 그대로 넘겨 LLM이 "여기는 측정 지역이 아니다"로 답하게 한다(3-state).
      // 라우트는 예보를 응답에서 빼지만(UI 미표기) 채팅은 서비스를 직접 불러
      // forecast까지 넘긴다 — "두 시간 뒤엔 어때?"에 답해야 하므로.
      // 카드 없음 — 산문이 정본(시각 정본은 "내 주변" 탭 LocalConditions).
      const { area } = await findCongestionNear(anchor.lat, anchor.lng);
      return { data: { ...placeNote(anchor), area }, source: src };
    }
    case "get_surroundings": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const around = await findSurroundingsNear(anchor.lat, anchor.lng);
      const render = placeMode
        ? undefined
        : ({ type: "surroundings-nearby", places: around.slice(0, 12).map(surroundingPlaceToPlace) } as const);
      return { data: { ...placeNote(anchor), count: around.length, places: around.slice(0, 12) }, render, source: src };
    }
    case "get_walk_infrastructure": {
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      const walk = await getWalkInfrastructure(anchor.lat, anchor.lng);
      // 출처는 실제로 데이터를 보여준 소스만 인용한다(성공한 소스만, 실패·미제공
      // 소스는 인용하지 않는다).
      const walkSource = [
        walk.audioSignals.status === "ok" ? { label: "source.seoulopen" } : undefined,
        walk.osm.status === "ok" ? { label: "source.osm" } : undefined,
      ].filter((s): s is { label: string } => s !== undefined);
      return {
        data: { ...placeNote(anchor), audioSignals: walk.audioSignals, osm: walk.osm },
        source: walkSource.length > 0 ? walkSource : undefined,
      };
    }
    case "get_where_am_i": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      // 네 조각 allSettled 조립(조각 실패는 null·빈 배열). 전부 비면 "정보 없음"이 아니라 조회 실패다
      // (라우트의 502 판정 동형) — LLM이 "주소가 없는 곳"으로 답하지 않게 error로 가른다. 카드 없음.
      const w = await assembleWhereAmI(coord.lat, coord.lng);
      if (!w.address && !w.region && !w.nearestStation && w.landmarks.length === 0) {
        return { data: { error: "위치 정보를 찾지 못했습니다." }, source: src };
      }
      // 기준점은 정위에 필요한 축만(이름·분류·거리·방위) — id·링크·좌표는 산문에 쓰이지 않는다.
      const landmarks = w.landmarks
        .slice(0, WHERE_AM_I_LANDMARKS_CAP)
        .map((l) => ({ name: l.name, category: l.categoryRaw, distanceMeters: l.distanceMeters, bearing: l.bearing }));
      return { data: { ...placeNote(coord), ...w, landmarks }, source: src };
    }
    case "get_nearby_overview": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      // 불릿별 3-state(ok/none/unavailable/failed)는 조립이 판정한다 — 그대로 싣는다.
      // 카드는 `places`(props-driven, 산문이 이름을 부르는 장소와 같은 순서·같은 좌표)라 지명·앵커
      // 조회에도 낸다 — self-fetch 카드 금지(placeMode)는 좌표가 어긋나는 카드에만 걸린다.
      // 이 카드가 iOS "장소 N곳" 헤딩·산문 블록 버튼(chatPlaceMentions)의 유일한 근거다(spec 2026-08-24 §2.2).
      const { overview, places } = await assembleNearbyOverview(coord.lat, coord.lng);
      return {
        data: { ...placeNote(coord), ...overview },
        render: places.length > 0 ? ({ type: "places", places } as const) : undefined,
        source: overviewSources(overview.bullets),
      };
    }
    case "get_bus_arrivals": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      const stops = await fetchNearbyBusStops(coord.lat, coord.lng);
      if (stops.length === 0 && (await isUncoveredBusRegion(coord.lat, coord.lng))) {
        return { data: NO_BUS_DATA, source: src };
      }
      // 명시 지명 또는 장소 앵커 → place 모드(카드가 그 좌표를 fetch). 아니면 current.
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bus" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bus" as const, mode: "current" as const };
      return { data: { ...placeNote(coord), count: stops.length, stops: stops.slice(0, 5) }, render, source: src };
    }
    case "get_bus_route": {
      // 노선 번호 조회(E87). 카드 없음 — 산문이 정본. 좌표는 노선을 고르고 타는 정류소를 짐작하는 데만 쓰고 data에 싣지 않는다.
      const routeNo = normalizeRouteNo(String(args.routeNo ?? ""));
      if (!routeNo) return { data: { error: "노선 번호가 필요합니다." } };
      const explicit = args.place ? String(args.place) : undefined;
      const resolved = await resolveCoord(explicit, ctx);
      if (explicit && !resolved) return { data: placeNotFound(explicit) };
      // 번호로 묻는 조회라 위치가 없거나 한국 밖이어도 답한다(그때는 서울 노선만 본다).
      const coord = resolved && isInKorea(resolved.lat, resolved.lng) ? resolved : undefined;
      const fromStop = args.fromStop ? String(args.fromStop) : undefined;
      const toStop = args.toStop ? String(args.toStop) : undefined;
      const roman = ctx.dataLocale === "en";
      const found = await lookupBusRoute({ routeNo, coord, fromStop, regionOnly: Boolean(explicit) }, busRouteDeps);
      const note = resolved ? placeNote(resolved) : {};
      // 지명은 지역을 가리는 데만 쓴다: 「부산」이 해운대해수욕장으로 풀린 실측이 있어(2026-11-14), 그 좌표로 타는 정류소나
      // 「근처를 지난다」를 말하면 사용자가 말하지 않은 곳이 답에 선다.
      const here = explicit ? undefined : coord;
      const shown = (c: BusRouteCandidate): BusRouteCandidate => (explicit ? { ...c, nearYou: null } : c);
      const searched = BUS_ROUTE_SEARCHED[found.local];
      if (found.kind === "notFound") {
        return {
          data: { ...note, found: false, routeNo, searched, ...(found.similar.length > 0 ? { similarRouteNos: found.similar } : {}) },
          source: src,
        };
      }
      // 기준 위치 지역을 찾아보지 못했거나 한쪽 번호 검색이 실패했으면 더 맞는 노선을 놓쳤을 수 있다: 찾은 노선에도 범위를 싣는다
      // (강릉에서 물은 202번에 서울·남양주 노선만 내놓고 강릉을 못 봤다는 말을 빼면 3-state가 무너진다, 실호출 2026-11-14).
      // 범위는 data의 맨 앞에 둔다: 뒤에 두면 모델이 후보만 읽고 범위를 빼먹었다(같은 실호출, 2회 중 2회).
      const scope = {
        ...(found.local === "uncovered" ? { unavailableHere: NO_BUS_DATA.unavailableHere } : {}),
        ...(found.local === "seoul" || found.local === "searched" ? {} : { searched }),
        ...(found.searchFailed.length > 0 ? { searchIncomplete: true } : {}),
      };
      if (found.kind === "ambiguous") {
        return {
          data: {
            ...scope,
            ...note,
            routeNo,
            candidates: found.candidates.map((c) => summarizeBusLine(shown(c), roman)),
            ...(found.more ? { moreCandidates: true } : {}),
          },
          source: src,
        };
      }
      return { data: { ...scope, ...note, ...describeBusRoute(shown(found.chosen), { coord: here, fromStop, toStop, roman }) }, source: src };
    }
    case "get_bike_stations": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      // 대여소가 서울 안에만 있다 — 지방의 0건은 "지금 없다"가 아니라 "서비스가 없다".
      if (!isBikeServiceArea(coord.lat, coord.lng)) return { data: SEOUL_ONLY, source: src };
      const stations = await fetchNearbyBikeStations(coord.lat, coord.lng);
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bike" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bike" as const, mode: "current" as const };
      return { data: { ...placeNote(coord), count: stations.length, stations: stations.slice(0, 5) }, render, source: src };
    }
    case "get_air_quality": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      const air = await findAirQualityNear(coord.lat, coord.lng);
      return { data: { ...placeNote(coord), air }, render: { type: "air-quality", lat: coord.lat, lng: coord.lng }, source: src };
    }
    case "get_weather": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(coord);
      if (gated) return gated;
      // 카드 없음 — 산문이 정본(시각 카드 정본은 "내 주변" 탭 LocalConditions).
      const weather = await findWeatherNear(coord.lat, coord.lng);
      return { data: { ...placeNote(coord), weather }, source: src };
    }
    case "get_station_meta": {
      const stationName = String(args.stationName ?? "");
      if (!stationName) return { data: { error: "역 이름이 필요합니다." } };
      const meta = findStationMeta(stationName);
      return { data: { meta }, render: { type: "station-meta", stationName }, source: src };
    }
    case "get_station_facilities": {
      const stationName = String(args.stationName ?? "");
      if (!stationName) return { data: { error: "역 이름이 필요합니다." } };
      const [korail, metro] = await Promise.all([
        fetchStationFacilities(stationName),
        fetchSeoulMetroFacilities(stationName),
      ]);
      return { data: { korail, metro }, render: { type: "station-facilities", stationName }, source: src };
    }
    case "get_station_timetable": {
      const stationName = String(args.stationName ?? "");
      if (!stationName) return { data: { error: "역 이름이 필요합니다." } };
      // null=TAGO 미커버 역, partial=일부 노선 실패, lines[].coverage=노선별 확인 불가·편성 없음·실패 —
      // 서비스 판정을 그대로 싣는다(무운행 위장 금지, 문구 뜻은 declaration이 LLM에 가르친다).
      // 카드 없음 — 산문이 정본(시각 정본은 장소 상세 "역 정보").
      const timetable = await fetchStationTimetable(stationName);
      return { data: { timetable }, source: src };
    }
    case "get_barrier_free_detail": {
      const contentId = String(args.contentId ?? "");
      if (!contentId) {
        // 이름으로 찾기(E88 spec B2): `name` 인자, 없으면 장소 채팅의 앵커 장소.
        const named = typeof args.name === "string" ? args.name.trim() : "";
        const anchor = ctx.placeAnchor;
        let target: { lat: number; lng: number; names: string[]; label: string };
        if (anchor && (!named || isAnchorName(named, anchor))) {
          // 보고 있는 장소는 앱이 좌표를 쥐고 있다 — 이름을 다시 검색하면 다른 지점의 같은 이름으로 갈 수 있다.
          target = { lat: anchor.lat, lng: anchor.lng, names: [anchor.name], label: anchor.name };
        } else if (named) {
          const found = await searchPlaces({ query: named, lang: ctx.dataLocale });
          const place = found.places[0];
          if (!place) return { data: placeNotFound(named) };
          const addr = place.roadAddress || place.address;
          target = {
            lat: place.lat,
            lng: place.lng,
            names: [named, place.name],
            label: addr ? `${place.name} (${addr})` : place.name,
          };
        } else {
          return { data: { error: "contentId 또는 장소 이름(name)이 필요합니다." } };
        }
        const gated = coverageGate(target);
        if (gated) return gated;
        const lookup = await findBarrierFreeByName(target);
        if (!lookup.detail) {
          return {
            data: {
              matched: false,
              searchedPlace: target.label,
              ...(lookup.similar.length > 0 ? { similar: lookup.similar } : {}),
              notice: BARRIER_FREE_NOT_REGISTERED,
            },
            source: src,
          };
        }
        return { data: { matched: true, searchedPlace: target.label, detail: lookup.detail }, source: src };
      }
      // null=항목 없음, facilities:[]=등록 시설 없음 — 두 상태를 뭉개지 않는다. 카드 없음.
      // detailWithTour2는 title을 주지 않아 name이 빈 문자열로 온다(실호출 2026-08-23) —
      // 이름은 LLM이 연쇄 원본(get_nearby_barrier_free)에서 이미 알고 있으므로 빈 값은 싣지 않는다.
      const detail = await getBarrierFreeDetail(contentId);
      if (!detail) return { data: { detail: null }, source: src };
      const { name, ...rest } = detail;
      return { data: { detail: name ? detail : rest }, source: src };
    }
    case "get_entrance_sides": {
      // 입구 기준 좌우(E88 spec ⓒ). 이름이 필수다 — 현재 위치(보도 위 GPS)에서는 방향 축이 거의 서지 않는다.
      const named = typeof args.place === "string" ? args.place.trim() : "";
      if (!named) return { data: { error: "장소 이름(place)이 필요합니다. 현재 위치를 기준으로는 입구 방향을 정할 수 없습니다." } };
      // names: 그 장소를 부르는 이름들 — 결과에서 그 장소 자신을 뺀다(「경복궁 입구 오른쪽에 경복궁」).
      let target: { lat: number; lng: number; label: string; names: string[] };
      if (isAnchorName(named, ctx.placeAnchor)) {
        const a = ctx.placeAnchor;
        target = { lat: a.lat, lng: a.lng, label: a.name, names: [a.name] };
      } else {
        const c = await resolveCoord(named, ctx);
        if (!c) return { data: placeNotFound(named) };
        target = { lat: c.lat, lng: c.lng, label: c.resolvedPlace ?? named, names: [named, c.resolvedName ?? named] };
      }
      const gated = coverageGate(target);
      if (gated) return gated;
      const scene = await assembleScene(target.lat, target.lng);
      return { data: entranceSidesData(scene, target.label, target.names), source: src };
    }
    case "get_car_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      // 카드는 경유 없는 경로를 self-fetch하므로 경유지가 있으면 내지 않는다(산문이 정본).
      // 안내 시작 카드를 신고한 요청(E83 R2)에는 옛 요약 카드를 어느 갈래에서도 내지 않는다 — 경로를 찾은 때에만 `route-start`가 간다(R3).
      const startCard = ctx.routeStart !== undefined;
      // 말한 출발지(E88): 종전 카드는 기기 위치로 다시 조회하고 안내 시작 카드는 실제 위치에서만 시작하므로 어느 렌더도 내지 않는다.
      const originName = originArg(args);
      const render = args.via || startCard || originName ? undefined : { type: "car-route" as const, dest };
      const useEn = ctx.dataLocale === "en" && hasNcpMapsKeys();
      // en(NCP)은 경유지 계약이 없다 — ko 서비스로 내리면 영어 사용자에게 한국어 안내문이 간다(리뷰
      // 검출). 대중교통과 같은 정직 마커로 답한다(upstream·지명 해석 미호출).
      if (args.via && useEn) {
        return { data: { destination: p.name, briefing: null, ...TRANSIT_WAYPOINT_UNSUPPORTED }, source: src };
      }
      const named = originName ? await resolveCoord(originName, ctx) : undefined;
      if (originName && !named) return { data: placeNotFound(originName) };
      const origin = named ? { lat: named.lat, lng: named.lng } : ctx.userLocation;
      if (!origin) return { data: NO_LOCATION, render, source: src };
      const gated = originCoverageGate(named, origin);
      if (gated) return gated;
      const via = await resolveVia(args, ctx);
      if (via === null) return { data: placeNotFound(String(args.via)) };
      const viaGated = via && coverageGate(via);
      if (viaGated) return viaGated;
      const briefing = useEn
        ? await getCarRouteBriefingEn({ origin, dest: { lat: p.lat, lng: p.lng } })
        : await getCarRoute({ origin, dest: { lat: p.lat, lng: p.lng }, via });
      return {
        data: {
          destination: p.name,
          ...originNote(named),
          ...(via ? { via: { name: via.name, stepIndex: briefing.waypoint?.stepIndex ?? null } } : {}),
          briefing,
        },
        // 경유지가 있어도 낸다(`via` 실음, 판정 7) — 그 경유지로 안내를 시작할 수 있는지는 클라이언트가 가른다(R9·R10).
        render: named
          ? undefined
          : startCard
            ? routeStartRender(p, { mode: "car", via: routeStartVia(via), carProvider: briefing.provider ?? null })
            : render,
        source: src,
      };
    }
    case "get_transit_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      // ODsay에 경유지가 없다(N4) — route:null만 주면 "경로 없음"으로 낭독돼 거짓이라 마커로 가른다.
      // upstream·지명 해석 모두 미호출(라우트 동형).
      if (args.via) return { data: { destination: p.name, route: null, ...TRANSIT_WAYPOINT_UNSUPPORTED }, source: src };
      const routeStart = ctx.routeStart;
      const originName = originArg(args);
      // 수단 한정(E88): 지하철만·버스만. 두 값이 아니면 한정 없이 조회한다.
      const mode = args.mode === "subway" || args.mode === "bus" ? args.mode : undefined;
      const modeAxis = mode ? { modeAxis: TRANSIT_MODE_AXIS[mode] } : {};
      // 안내 시작 카드를 신고한 요청(E83 R2)에는 옛 요약 카드를 내지 않는다. 옛 카드는 기기 위치에서 수단 한정 없이 다시
      // 조회하므로 말한 출발지·수단 한정의 답과 어긋난다(E88) — 그 답에도 내지 않는다.
      const render = routeStart || originName || mode ? undefined : { type: "transit-route" as const, dest };
      const named = originName ? await resolveCoord(originName, ctx) : undefined;
      if (originName && !named) return { data: placeNotFound(originName) };
      const origin = named ? { lat: named.lat, lng: named.lng } : ctx.userLocation;
      if (!origin) return { data: NO_LOCATION, render, source: src };
      const gated = originCoverageGate(named, origin);
      if (gated) return gated;
      // ⚠ 과금: 수단을 한정한 조회는 URL에 `SearchPathType`이 붙어 한정 없는 조회와 캐시 항목이 따로다(ODsay 호출 1회).
      const route = await getTransitRoute({ origin, dest: { lat: p.lat, lng: p.lng }, ...modeAxis });
      const data = {
        destination: p.name,
        ...originNote(named),
        ...(mode ? { mode } : {}),
        route,
        // 「그 수단만으로는 없음」은 「경로 없음」과 다르다(조회 실패는 위에서 throw).
        ...(mode && !route ? NO_ROUTE_WITH_MODE : {}),
      };
      // 말한 출발지의 답에는 안내 시작 카드도 없다(안내는 실제 위치에서만 시작한다) — 카드용 조회도 하지 않는다.
      if (!routeStart || !route || named) return { data, render, source: src };
      // 카드가 싣는 결과는 길찾기 화면이 받는 것과 같은 옵션으로 한 번 더 받는다(E83 spec §4 — 경유 정류장·노선 집합·데이터 언어):
      // 화면이 그 결과로 대중교통 섹션을 그대로 세우고 안내를 시작한다. 모델에 주는 `data`는 위 조회 그대로다(신고와 무관하게 같다).
      // ⚠ 과금: 한국어 데이터 로케일은 위 조회와 ODsay URL이 같아 캐시를 탄다(추가 호출 0). 영어 데이터 로케일은 `lang`이 달라
      // **별도 ODsay 호출 1회**가 더 나간다(호출 수가 곧 비용 — 신고한 영어 채팅의 대중교통 질문마다).
      // 이 조회만 실패하면 카드 없이 답한다(경로를 못 찾은 것이 아니다).
      let cardResult: Awaited<ReturnType<typeof getTransitRoute>> = null;
      try {
        cardResult = await getTransitRoute({
          origin,
          dest: { lat: p.lat, lng: p.lng },
          includeStops: true,
          includeLanes: true,
          lang: ctx.dataLocale,
          // 수단을 한정한 답이면 카드도 같은 수단의 경로를 싣는다(답과 카드가 같은 경로).
          ...modeAxis,
        });
      } catch (e) {
        console.error("[chat] 안내 시작 카드용 대중교통 조회 실패:", e);
      }
      return {
        data,
        render: cardResult
          ? routeStartRender(p, {
              mode: "transit",
              transit: {
                result: cardResult,
                origin: { lat: origin.lat, lng: origin.lng },
                queriedAt: Date.now(),
                manualOrigin: routeStart.manualOrigin,
              },
            })
          : undefined,
        source: src,
      };
    }
    case "get_walk_route": {
      // declaration 게이트가 이미 hasWalkRouteKey()로 노출을 막지만, 직접 호출(테스트·
      // 회귀) 경로도 차단하는 실행부 이중 방어.
      if (!hasWalkRouteKey()) {
        return { data: { error: "도보 길찾기는 API 키 등록 후 사용할 수 있습니다." } };
      }
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const originName = originArg(args);
      const named = originName ? await resolveCoord(originName, ctx) : undefined;
      if (originName && !named) return { data: placeNotFound(originName) };
      const origin = named ? { lat: named.lat, lng: named.lng } : ctx.userLocation;
      if (!origin) return { data: NO_LOCATION, source: src };
      const gated = originCoverageGate(named, origin);
      if (gated) return gated;
      const via = await resolveVia(args, ctx);
      if (via === null) return { data: placeNotFound(String(args.via)) };
      const viaGated = via && coverageGate(via);
      if (viaGated) return viaGated;
      const accessible = args.accessible === true;
      const briefing = await getWalkRoute({
        origin,
        dest: { lat: p.lat, lng: p.lng },
        // 채팅 도구는 ko 고정이다 — 이 도구는 ko 트리거 문구로만 노출된다(E16 축3 범위 밖).
        lang: "ko",
        accessible,
        // 앱 화면 첫 줄(E42 — ko는 최단)과 맞춘다. 계단 회피 요청은 서버 계단 회피 파이프라인(화면의 계단 회피 줄과 같은 축)이다.
        ...(accessible ? {} : { variant: "shortest" as const }),
        via,
        // 서버 내부 호출이라 스토어 빌드 호환과 무관하다 — 문안 확정본(판본 2).
        text: { wording: 2 },
      });
      // 경로 없음(예: 도보 불가 구간)은 get_transit_route와 동형으로 route:null을
      // 그대로 data에 실어 LLM이 "경로를 찾지 못했다"로 해석하게 한다.
      if (!briefing) return { data: { destination: p.name, ...originNote(named), briefing: null }, source: src };
      // 경유지 도착 스텝은 절단 밖에 두지 않는다 — stepIndex가 LLM이 받은 배열 범위 밖을 가리키면
      // 존재하지 않는 스텝을 추론(날조)하게 된다(리뷰 검출 2026-08-23).
      const stepsCap = Math.max(WALK_STEPS_CAP, (briefing.waypoint?.stepIndex ?? -1) + 1);
      const steps = briefing.steps.slice(0, stepsCap);
      const truncated = briefing.steps.length > steps.length;
      return {
        data: {
          destination: p.name,
          ...originNote(named),
          distanceMeters: briefing.distanceMeters,
          durationSeconds: briefing.durationSeconds,
          steps,
          ...(truncated ? { truncated } : {}),
          // 경유지 도착 지점은 steps[stepIndex](스텝 0 삽입 보정 완료본) — 구획 문장은 LLM이 그린다(서버 불변).
          ...(via ? { via: { name: via.name, stepIndex: briefing.waypoint?.stepIndex ?? null } } : {}),
          // 안전 문장은 steps[0]에 이미 삽입돼 있어 LLM 재량과 무관하게 전달된다 —
          // stepFree 상태값도 함께 실어 LLM이 명시적으로 언급할 수 있게 한다.
          ...(briefing.stepFree ? { stepFree: briefing.stepFree } : {}),
        },
        // 안내 시작 카드(E83) — 신고한 요청에만. 도보 안내는 시작할 때 경로를 새로 받으므로 도착지·경유지·계단 회피만 싣는다(R4).
        // 말한 출발지의 답에는 내지 않는다(E88 — 안내는 실제 위치에서만 시작한다).
        ...(ctx.routeStart && !named ? { render: routeStartRender(p, { mode: "walk", via: routeStartVia(via), accessible }) } : {}),
        source: src,
      };
    }
    case "plan_journey":
      // 여정(E70-b): 턴 규칙·역 해석·예산 진입점은 `journey-tool.ts`에 있다. `ctx.journey`가 없으면 거절한다.
      return executePlanJourney(args, ctx);
    case "search_web": {
      // perplexity-search가 data·render를 빚고, 출처는 여기서 부착(실패면 카드 없음).
      const result = await searchWebPerplexity(args);
      return { ...result, source: result.render ? src : undefined };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
