/**
 * Gemini function call → provider 직접 호출 라우터. React/Next 비의존.
 * 각 도구는 provider를 직접 호출해 LLM용 data를 만들고, 카드 마운트 지시(render)와
 * 출처(source)를 함께 반환한다. 도구 내부 실패는 호출자(agent-loop)가 흡수한다.
 */
import type { ExecutionContext, ToolResult } from "./types";
import { searchPlaces } from "@/lib/providers/places";
import { searchJusoAddresses } from "@/lib/providers/juso-address";
import { findAirQualityNear } from "@/lib/providers/air-quality";
import { fetchNearbySubwayArrivals } from "@/lib/providers/subway-nearby";
import { fetchNearbyBusStops } from "@/lib/bus";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";
import { findNightClinicsNear } from "@/lib/providers/night-clinic";
import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { findStationMeta } from "@/lib/subway-stations";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";
import { getCarRouteBriefing } from "@/lib/providers/kakao-navi";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";
import { getTransitRoute } from "@/lib/providers/odsay";
import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";
import { searchWebPerplexity } from "./perplexity-search";
import { hasNcpMapsKeys, hasTmapKey } from "@/lib/env";
import { placesToRender, placesToData, addressesToRender, addressesToData } from "./render";
import { sourceFor } from "./sources";

/** 좌표 도구의 기준 좌표 — 장소 앵커 우선, 없으면 현재 위치. */
export function anchorOf(
  ctx: ExecutionContext,
): { lat: number; lng: number } | undefined {
  return ctx.placeAnchor ?? ctx.userLocation;
}

/** 지명 → 좌표(카카오 지오코딩 첫 결과). 미지정이면 장소 앵커/현재 위치. */
async function resolveCoord(
  place: string | undefined,
  ctx: ExecutionContext,
): Promise<{ lat: number; lng: number } | undefined> {
  if (place) {
    const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
    const p = r.places[0];
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }
  return anchorOf(ctx);
}

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };

/** get_walk_route가 LLM에 넘기는 steps 상한 — Tmap 도보 경로는 교차로마다
 * 안내 지점이 생겨 자동차·대중교통보다 단계 수가 훨씬 많다(토큰 방어). */
const WALK_STEPS_CAP = 20;

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
      const result = await searchPlaces({
        query,
        lang: ctx.dataLocale,
        lat: anchor?.lat,
        lng: anchor?.lng,
      });
      return { data: placesToData(result.places), render: placesToRender(result.places), source: src };
    }
    case "search_address": {
      const keyword = String(args.keyword ?? "");
      const results = await searchJusoAddresses(keyword);
      return { data: addressesToData(results), render: addressesToRender(results), source: src };
    }
    case "get_subway_arrivals": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const arrivals = await fetchNearbySubwayArrivals(anchor.lat, anchor.lng);
      // 장소 앵커일 땐 device-self-fetch 카드가 장소와 어긋나므로 생략(산문이 정본).
      const render = ctx.placeAnchor ? undefined : ({ type: "subway-nearby" } as const);
      return { data: { count: arrivals.length, arrivals }, render, source: src };
    }
    case "get_night_clinics": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const clinics = await findNightClinicsNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "clinics-nearby" } as const);
      return { data: { count: clinics.length, clinics: clinics.slice(0, 5) }, render, source: src };
    }
    case "get_nearby_barrier_free": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const places = await searchBarrierFreeNearby(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "barrier-free-nearby" } as const);
      return { data: { count: places.length, places: places.slice(0, 8) }, render, source: src };
    }
    case "get_kids_places": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const kids = await findKidsPlacesNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "kids-nearby" } as const);
      return { data: { count: kids.length, places: kids.slice(0, 8) }, render, source: src };
    }
    case "get_surroundings": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const around = await findSurroundingsNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "surroundings-nearby" } as const);
      return { data: { count: around.length, places: around.slice(0, 12) }, render, source: src };
    }
    case "get_bus_arrivals": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stops = await fetchNearbyBusStops(coord.lat, coord.lng);
      // 명시 지명 또는 장소 앵커 → place 모드(카드가 그 좌표를 fetch). 아니면 current.
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bus" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bus" as const, mode: "current" as const };
      return { data: { count: stops.length, stops: stops.slice(0, 5) }, render, source: src };
    }
    case "get_bike_stations": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stations = await fetchNearbyBikeStations(coord.lat, coord.lng);
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bike" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bike" as const, mode: "current" as const };
      return { data: { count: stations.length, stations: stations.slice(0, 5) }, render, source: src };
    }
    case "get_air_quality": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const air = await findAirQualityNear(coord.lat, coord.lng);
      return { data: { air }, render: { type: "air-quality", lat: coord.lat, lng: coord.lng }, source: src };
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
    case "get_car_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      const render = { type: "car-route" as const, dest };
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const briefing = ctx.dataLocale === "en" && hasNcpMapsKeys()
        ? await getCarRouteBriefingEn({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } })
        : await getCarRouteBriefing({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      return { data: { destination: p.name, briefing }, render, source: src };
    }
    case "get_transit_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      const render = { type: "transit-route" as const, dest };
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const route = await getTransitRoute({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      return { data: { destination: p.name, route }, render, source: src };
    }
    case "get_walk_route": {
      // declaration 게이트가 이미 hasTmapKey()로 노출을 막지만, 직접 호출(테스트·회귀)
      // 경로도 차단하는 실행부 이중 방어.
      if (!hasTmapKey()) {
        return { data: { error: "도보 길찾기는 API 키 등록 후 사용할 수 있습니다." } };
      }
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      if (!ctx.userLocation) return { data: NO_LOCATION, source: src };
      const briefing = await getWalkRouteBriefing({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      // 경로 없음(예: 도보 불가 구간)은 get_transit_route와 동형으로 route:null을
      // 그대로 data에 실어 LLM이 "경로를 찾지 못했다"로 해석하게 한다.
      if (!briefing) return { data: { destination: p.name, briefing: null }, source: src };
      const steps = briefing.steps.slice(0, WALK_STEPS_CAP);
      const truncated = briefing.steps.length > steps.length;
      return {
        data: {
          destination: p.name,
          distanceMeters: briefing.distanceMeters,
          durationSeconds: briefing.durationSeconds,
          steps,
          ...(truncated ? { truncated } : {}),
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
