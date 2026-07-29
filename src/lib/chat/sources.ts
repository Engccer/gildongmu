/**
 * 도구 → 데이터 제공처(SourceAttribution) 매핑. 순수 함수(React/Next 비의존).
 * label은 i18n 키(messages의 chat.<label>). dataLocale로 ko/en 분기(경로·장소).
 */
import type { SourceAttribution } from "./types";

const KAKAO: SourceAttribution = { label: "source.kakao" };
const TOURAPI: SourceAttribution = { label: "source.tourapi" };
const JUSO: SourceAttribution = { label: "source.juso" };
const SEOUL_OPEN: SourceAttribution = { label: "source.seoulopen" };
const AIRKOREA: SourceAttribution = { label: "source.airkorea" };
const KMA: SourceAttribution = { label: "source.kma" };
const TAGO: SourceAttribution = { label: "source.tago" };
const NMC: SourceAttribution = { label: "source.nmc" };
const KAKAO_MOBILITY: SourceAttribution = { label: "source.kakaomobility" };
const NCP: SourceAttribution = { label: "source.ncp" };
const ODSAY: SourceAttribution = { label: "source.odsay" };
const TMAP: SourceAttribution = { label: "source.tmap" };
const KRIC: SourceAttribution = { label: "source.kric" };
const KORAIL: SourceAttribution = { label: "source.korail" };
const SEOUL_METRO: SourceAttribution = { label: "source.seoulmetro" };
const PERPLEXITY: SourceAttribution = { label: "source.perplexity", url: "https://www.perplexity.ai" };

export function sourceFor(
  tool: string,
  ctx: { dataLocale: "ko" | "en" },
): SourceAttribution[] {
  switch (tool) {
    case "search_places":
      return ctx.dataLocale === "en" ? [KAKAO, TOURAPI] : [KAKAO];
    case "search_address":
      return [JUSO];
    case "get_subway_arrivals":
      return [SEOUL_OPEN];
    case "get_bike_stations":
      return [SEOUL_OPEN];
    case "get_bus_arrivals":
      return [TAGO];
    case "get_air_quality":
      return [AIRKOREA];
    case "get_weather":
      return [KMA];
    case "get_night_clinics":
      return [NMC];
    case "get_nearby_barrier_free":
      return [TOURAPI];
    case "get_kids_places":
    case "get_surroundings":
      return [KAKAO];
    case "get_station_meta":
      return [KRIC];
    case "get_station_facilities":
      return [KORAIL, SEOUL_METRO];
    case "get_car_route":
      // 기본 Tmap·폴백 카카오모빌리티 — 응답이 어느 쪽에서 왔는지 서비스가
      // 노출하지 않으므로(스키마 불변 계약) 두 제공처를 정직하게 병기.
      return ctx.dataLocale === "en" ? [NCP] : [TMAP, KAKAO_MOBILITY];
    case "get_transit_route":
      return [ODSAY];
    case "get_walk_route":
      // 기본 카카오(dapi.kakao.com 도보)·폴백 Tmap — 응답이 어느 쪽에서 왔는지
      // 서비스가 노출하지 않으므로(스키마 불변 계약) 두 제공처를 정직하게 병기.
      return [KAKAO, TMAP];
    case "search_web":
      return [PERPLEXITY];
    default:
      return [];
  }
}

export function dedupeSources(list: SourceAttribution[]): SourceAttribution[] {
  const seen = new Set<string>();
  const out: SourceAttribution[] = [];
  for (const s of list) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push(s);
  }
  return out;
}
