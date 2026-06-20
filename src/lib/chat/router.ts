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
import { fetchNearbyBusStops } from "@/lib/providers/tago-bus";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";
import { findNightClinicsNear } from "@/lib/providers/night-clinic";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { findStationMeta } from "@/lib/subway-stations";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";
import { getCarRouteBriefing } from "@/lib/providers/kakao-navi";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";
import { getTransitRoute } from "@/lib/providers/odsay";
import { hasNcpMapsKeys } from "@/lib/env";
import { placesToRender, placesToData, addressesToRender, addressesToData } from "./render";
import { sourceFor } from "./sources";

/** 지명 → 좌표(카카오 지오코딩 첫 결과) 또는 현재 위치. */
async function resolveCoord(
  place: string | undefined,
  ctx: ExecutionContext,
): Promise<{ lat: number; lng: number } | undefined> {
  if (place) {
    const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
    const p = r.places[0];
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }
  return ctx.userLocation;
}

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };

export async function executeFunction(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const src = sourceFor(name, ctx);
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      const result = await searchPlaces({ query, lang: ctx.dataLocale });
      return { data: placesToData(result.places), render: placesToRender(result.places), source: src };
    }
    case "search_address": {
      const keyword = String(args.keyword ?? "");
      const results = await searchJusoAddresses(keyword);
      return { data: addressesToData(results), render: addressesToRender(results), source: src };
    }
    case "get_subway_arrivals": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const arrivals = await fetchNearbySubwayArrivals(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: arrivals.length, arrivals }, render: { type: "subway-nearby" }, source: src };
    }
    case "get_night_clinics": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const clinics = await findNightClinicsNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: clinics.length, clinics: clinics.slice(0, 5) }, render: { type: "clinics-nearby" }, source: src };
    }
    case "get_kids_places": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const kids = await findKidsPlacesNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: kids.length, places: kids.slice(0, 8) }, render: { type: "kids-nearby" }, source: src };
    }
    case "get_surroundings": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const around = await findSurroundingsNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: around.length, places: around.slice(0, 12) }, render: { type: "surroundings-nearby" }, source: src };
    }
    case "get_bus_arrivals": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stops = await fetchNearbyBusStops(coord.lat, coord.lng);
      const mode = args.place ? "place" : "current";
      const render = mode === "place"
        ? { type: "bus" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bus" as const, mode: "current" as const };
      return { data: { count: stops.length, stops: stops.slice(0, 5) }, render, source: src };
    }
    case "get_bike_stations": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stations = await fetchNearbyBikeStations(coord.lat, coord.lng);
      const render = args.place
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
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
