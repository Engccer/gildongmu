/**
 * Gemini function call → provider 직접 호출 라우터. React/Next 비의존.
 * 각 도구는 provider를 직접 호출해 LLM용 data를 만들고, 카드 마운트 지시(render)와
 * 출처(source)를 함께 반환한다. 도구 내부 실패는 호출자(agent-loop)가 흡수한다.
 */
import type { ExecutionContext, ToolResult } from "./types";
import type { PlaceSort } from "@/lib/types";
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
import { fetchSubwayArrivals } from "@/lib/providers/seoul-subway-arrival";
import { fetchNearbyBusStops, isUncoveredBusRegion } from "@/lib/bus";
import { fetchNearbyBikeStations, isBikeServiceArea } from "@/lib/providers/seoul-bike";
import { findNightClinicsNow } from "@/lib/clinics";
import { getBarrierFreeDetail, searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";
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
import { hasNcpMapsKeys, hasWalkRouteKey } from "@/lib/env";
import { placesToRender, placesToData, addressesToRender, addressesToData } from "./render";
import { overviewSources, sourceFor } from "./sources";
import { assembleWhereAmI } from "@/lib/where-am-i";
import { assembleNearbyOverview } from "@/lib/nearby-overview";
import { isInKorea } from "@/lib/coverage";

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
    return { lat: p.lat, lng: p.lng, resolvedPlace: addr ? `${p.name} (${addr})` : p.name };
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

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };

/** 지명 해석 실패는 위치 부재가 아니다 — 같은 문장으로 답하면 사용자가 권한을 의심한다. */
function placeNotFound(place: string) {
  return { error: `'${place}' 위치를 찾지 못했습니다.` };
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
      const stationName = args.stationName ? String(args.stationName) : undefined;
      if (stationName) {
        const byName = await fetchSubwayArrivals(stationName);
        return { data: byName ? { ...byName } : { stationName, arrivals: null }, source: src };
      }
      const explicit = args.place ? String(args.place) : undefined;
      const anchor = await resolveCoord(explicit, ctx);
      if (!anchor) return { data: explicit ? placeNotFound(explicit) : NO_LOCATION };
      const gated = coverageGate(anchor);
      if (gated) return gated;
      // 명시 지명·장소 앵커 → 기기 위치 self-fetch 카드는 산문과 좌표가 어긋나므로 생략(산문이 정본).
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const arrivals = await fetchNearbySubwayArrivals(anchor.lat, anchor.lng);
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
      // 불릿별 3-state(ok/none/unavailable/failed)는 조립이 판정한다 — 그대로 싣는다. 카드 없음.
      const overview = await assembleNearbyOverview(coord.lat, coord.lng);
      return { data: { ...placeNote(coord), ...overview }, source: overviewSources(overview.bullets) };
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
      if (!contentId) return { data: { error: "contentId가 필요합니다." } };
      // null=항목 없음, facilities:[]=등록 시설 없음 — 두 상태를 뭉개지 않는다. 카드 없음.
      // detailWithTour2는 title을 주지 않아 name이 빈 문자열로 온다(실호출 2026-08-23) —
      // 이름은 LLM이 연쇄 원본(get_nearby_barrier_free)에서 이미 알고 있으므로 빈 값은 싣지 않는다.
      const detail = await getBarrierFreeDetail(contentId);
      if (!detail) return { data: { detail: null }, source: src };
      const { name, ...rest } = detail;
      return { data: { detail: name ? detail : rest }, source: src };
    }
    case "get_car_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      // 카드는 경유 없는 경로를 self-fetch하므로 경유지가 있으면 내지 않는다(산문이 정본).
      const render = args.via ? undefined : { type: "car-route" as const, dest };
      const useEn = ctx.dataLocale === "en" && hasNcpMapsKeys();
      // en(NCP)은 경유지 계약이 없다 — ko 서비스로 내리면 영어 사용자에게 한국어 안내문이 간다(리뷰
      // 검출). 대중교통과 같은 정직 마커로 답한다(upstream·지명 해석 미호출).
      if (args.via && useEn) {
        return { data: { destination: p.name, briefing: null, ...TRANSIT_WAYPOINT_UNSUPPORTED }, source: src };
      }
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const gated = coverageGate(ctx.userLocation);
      if (gated) return gated;
      const via = await resolveVia(args, ctx);
      if (via === null) return { data: placeNotFound(String(args.via)) };
      const viaGated = via && coverageGate(via);
      if (viaGated) return viaGated;
      const briefing = useEn
        ? await getCarRouteBriefingEn({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } })
        : await getCarRoute({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng }, via });
      return {
        data: {
          destination: p.name,
          ...(via ? { via: { name: via.name, stepIndex: briefing.waypoint?.stepIndex ?? null } } : {}),
          briefing,
        },
        render,
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
      const render = { type: "transit-route" as const, dest };
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const gated = coverageGate(ctx.userLocation);
      if (gated) return gated;
      const route = await getTransitRoute({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      return { data: { destination: p.name, route }, render, source: src };
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
      if (!ctx.userLocation) return { data: NO_LOCATION, source: src };
      const gated = coverageGate(ctx.userLocation);
      if (gated) return gated;
      const via = await resolveVia(args, ctx);
      if (via === null) return { data: placeNotFound(String(args.via)) };
      const viaGated = via && coverageGate(via);
      if (viaGated) return viaGated;
      const accessible = args.accessible === true;
      const briefing = await getWalkRoute({
        origin: ctx.userLocation,
        dest: { lat: p.lat, lng: p.lng },
        // 채팅 도구는 ko 고정이다 — 이 도구는 ko 트리거 문구로만 노출된다(E16 축3 범위 밖).
        lang: "ko",
        accessible,
        via,
      });
      // 경로 없음(예: 도보 불가 구간)은 get_transit_route와 동형으로 route:null을
      // 그대로 data에 실어 LLM이 "경로를 찾지 못했다"로 해석하게 한다.
      if (!briefing) return { data: { destination: p.name, briefing: null }, source: src };
      // 경유지 도착 스텝은 절단 밖에 두지 않는다 — stepIndex가 LLM이 받은 배열 범위 밖을 가리키면
      // 존재하지 않는 스텝을 추론(날조)하게 된다(리뷰 검출 2026-08-23).
      const stepsCap = Math.max(WALK_STEPS_CAP, (briefing.waypoint?.stepIndex ?? -1) + 1);
      const steps = briefing.steps.slice(0, stepsCap);
      const truncated = briefing.steps.length > steps.length;
      return {
        data: {
          destination: p.name,
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
        source: src,
      };
    }
    case "search_web": {
      // perplexity-search가 data·render를 빚고, 출처는 여기서 부착(실패면 카드 없음).
      const result = await searchWebPerplexity(args);
      return { ...result, source: result.render ? src : undefined };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
