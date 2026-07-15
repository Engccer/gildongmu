import { joinText } from "./output.js";

/**
 * 도메인 산문 포매터 — 라우트 응답 body(envelope 포함) → 항목당 한 줄 산문.
 *
 * 타입은 웹 `src/lib/types.ts`와 대조 완료된 필드만 로컬 재선언한다(씬 클라이언트
 * 독립성 — packages/cli는 웹 타입을 import하지 않는다). 3-state 불변식(0건 없음 ≠
 * unknown 필드 생략 ≠ 조회 실패/미제공)을 여기서 보존한다.
 */

// ── 로컬 타입(필드는 웹 types.ts 대조 완료) ────────────────────────────

interface PlaceItem {
  name: string;
  category: string;
  address: string;
  roadAddress: string;
  phone?: string;
  distanceMeters?: number;
}

interface KidsPlaceItem {
  name: string;
  category: string;
  address: string;
  roadAddress?: string;
  phone?: string;
  distanceMeters: number;
  kind: "kidscafe" | "playground" | "playcenter" | "park";
  indoorOutdoor: "indoor" | "outdoor" | "unknown";
}

interface JusoAddressItem {
  roadAddr: string;
  jibunAddr: string;
  zipNo: string;
  engAddr: string;
}

interface SubwayArrivalItem {
  line?: string;
  trainLineNm: string;
  message: string;
  express: boolean;
}

interface NearbySubwayStationItem {
  stationName: string;
  lines: string[];
  distanceMeters: number;
  arrivalStatus: "ok" | "unavailable";
  arrivals: SubwayArrivalItem[];
}

interface SubwayStationArrivalsItem {
  arrivals: SubwayArrivalItem[];
}

interface BusArrivalItem {
  routeNo: string;
  routeType: string;
  arrivalSeconds: number;
  prevStationCount: number;
  lowFloor: boolean;
  arrivalMessage?: string;
}

interface BusStopItem {
  name: string;
  stopNo?: string;
  distanceMeters: number;
  arrivalStatus: "ok" | "unavailable";
  arrivals: BusArrivalItem[];
}

interface BusRouteStopItem {
  order: number;
  name: string;
}

interface BikeStationItem {
  name: string;
  distanceMeters: number;
  racksTotal: number;
  bikesAvailable: number;
}

interface NightClinicItem {
  name: string;
  kind: string;
  phone: string;
  address: string;
  distanceMeters: number;
  openStatus: { state: "open" | "closed" | "unknown" };
}

type Bearing = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

interface SurroundingPlaceItem {
  name: string;
  categoryRaw: string;
  distanceMeters: number;
  bearing: Bearing;
}

interface BarrierFreePlaceItem {
  contentId: string;
  name: string;
  category: string;
  address: string;
  distanceMeters: number;
}

interface BarrierFreeFacilityItem {
  label: string;
  value: string;
}

interface BarrierFreeDetailItem {
  name: string;
  facilities: BarrierFreeFacilityItem[];
}

interface StationMetaItem {
  name: string;
  nameEn: string;
  lines: string[];
  isTransfer: boolean;
  operator: string;
}

interface StationFacilitiesItem {
  accessibleToilet: boolean;
  wheelchairLifts: number | undefined;
  accessibleSlope: boolean;
  elevators: number | undefined;
}

type MetroFacilityKind =
  | "elevator" | "escalator" | "wheelchairLift" | "movingWalk"
  | "wheelchairCharger" | "safetyPlatform" | "signLangPhone" | "helper" | "restroom";

interface MetroFacilityItem {
  name: string;
  location: string | undefined;
  floors: string | undefined;
  operatingStatus: "normal" | "stopped" | undefined;
}

interface MetroFacilityGroupItem {
  kind: MetroFacilityKind;
  facilities: MetroFacilityItem[];
}

interface SeoulMetroFacilitiesItem {
  groups: MetroFacilityGroupItem[];
}

interface CarRouteGuideItem {
  guidance: string;
  distanceMeters: number;
}

interface CarRouteBriefingItem {
  distanceMeters: number;
  durationSeconds: number;
  taxiFare: number;
  tollFare: number;
  guides: CarRouteGuideItem[];
}

interface TransitLegItem {
  mode: "walk" | "bus" | "subway";
  lineName?: string;
  fromName?: string;
  toName?: string;
  stationCount?: number;
  minutes: number;
}

interface TransitRouteItem {
  summary: { totalMinutes: number; fare: number; transfers: number; walkMinutes: number };
  legs: TransitLegItem[];
}

interface TransitRouteResultItem {
  recommended: TransitRouteItem;
  alternatives: TransitRouteItem[];
}

type SkyLabelItem = "clear" | "partlyCloudy" | "cloudy" | "unknown";
type PrecipLabelItem = "none" | "rain" | "rainSnow" | "snow" | "shower" | "unknown";

interface WeatherItem {
  sky: { label: SkyLabelItem };
  precipitation: { label: PrecipLabelItem };
  tempC: number | null;
  tempMax: number | null;
  tempMin: number | null;
  humidity: number | null;
  precipProbability: number | null;
  baseTime: string;
}

type AirGradeItem = "good" | "moderate" | "bad" | "veryBad" | "unknown";

interface AirPollutantItem {
  value: number | null;
  grade: AirGradeItem;
}

interface AirQualityItem {
  stationName: string;
  distanceKm: number;
  dataTime: string;
  khai: AirPollutantItem;
  pm10: AirPollutantItem;
  pm25: AirPollutantItem;
}

interface WhereAmIItem {
  address: { road?: string; jibun?: string } | null;
  region: string | null;
  nearestStation: { name: string; line?: string; bearing: Bearing; distanceMeters: number } | null;
  landmarks: SurroundingPlaceItem[];
}

interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

// ── 공통 헬퍼 ───────────────────────────────────────────────────────────

const m = (n: number): string => `${Math.round(n)}m`;

const COMPASS_KO: Record<Bearing, string> = {
  n: "북", ne: "북동", e: "동", se: "남동", s: "남", sw: "남서", w: "서", nw: "북서",
};

const KIDS_KIND_KO: Record<KidsPlaceItem["kind"], string> = {
  kidscafe: "키즈카페", playground: "놀이터", playcenter: "놀이센터", park: "어린이공원",
};

const METRO_KIND_KO: Record<MetroFacilityKind, string> = {
  elevator: "엘리베이터", escalator: "에스컬레이터", wheelchairLift: "휠체어 리프트",
  movingWalk: "무빙워크", wheelchairCharger: "전동휠체어 급속충전기",
  safetyPlatform: "안전발판", signLangPhone: "수어영상전화기",
  helper: "교통약자 도우미", restroom: "장애인 화장실",
};

// "unknown"·"none"은 의도적으로 매핑에서 빠진다 — joinText가 undefined를 걸러
// 해당 줄에서 생략한다(3-state: 정보 없음/해당 없음은 낭독하지 않는다).
const SKY_KO: Partial<Record<SkyLabelItem, string>> = {
  clear: "맑음", partlyCloudy: "구름많음", cloudy: "흐림",
};
const PRECIP_KO: Partial<Record<PrecipLabelItem, string>> = {
  rain: "비", rainSnow: "비또는눈", snow: "눈", shower: "소나기",
};

const AIR_GRADE_KO: Record<Exclude<AirGradeItem, "unknown">, string> = {
  good: "좋음", moderate: "보통", bad: "나쁨", veryBad: "매우나쁨",
};

/** 카카오 category_name 계층("여행 > 관광,명소")의 마지막 조각. */
function lastCategorySegment(categoryRaw: string): string {
  const parts = categoryRaw.split(">").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : categoryRaw;
}

function surroundingLine(p: SurroundingPlaceItem): string {
  return joinText(p.name, lastCategorySegment(p.categoryRaw), `${m(p.distanceMeters)} ${COMPASS_KO[p.bearing]}`);
}

function subwayArrivalLine(a: SubwayArrivalItem): string {
  return joinText(a.line, a.trainLineNm, a.message, a.express && "급행");
}

// ── 장소 검색(장소·명소 공유) ───────────────────────────────────────────

function placeLine(p: PlaceItem): string {
  return joinText(
    p.name,
    p.category,
    p.roadAddress || p.address,
    p.phone,
    typeof p.distanceMeters === "number" ? m(p.distanceMeters) : undefined,
  );
}

function formatPlaces(body: { places: PlaceItem[] }): string[] {
  if (body.places.length === 0) return ["검색 결과가 없습니다."];
  return body.places.map(placeLine);
}

function formatAddresses(body: { addresses: JusoAddressItem[] }): string[] {
  if (body.addresses.length === 0) return ["검색 결과가 없습니다."];
  return body.addresses.map((a) =>
    joinText(a.roadAddr, a.jibunAddr && `지번 ${a.jibunAddr}`, a.zipNo && `우편번호 ${a.zipNo}`, a.engAddr),
  );
}

function formatKids(body: { kids: KidsPlaceItem[] }): string[] {
  if (body.kids.length === 0) return ["주변에 아이 놀 곳이 없습니다."];
  return body.kids.map((p) =>
    joinText(
      p.name,
      p.category,
      p.roadAddress || p.address,
      p.phone,
      m(p.distanceMeters),
      KIDS_KIND_KO[p.kind],
      p.indoorOutdoor !== "unknown" ? (p.indoorOutdoor === "indoor" ? "실내" : "실외") : undefined,
    ),
  );
}

// ── 내 주변(좌표 기반) ──────────────────────────────────────────────────

function formatNearbySubway(body: { stations: NearbySubwayStationItem[] }): string[] {
  if (body.stations.length === 0) return ["주변에 지하철역이 없습니다."];
  const lines: string[] = [];
  for (const s of body.stations) {
    lines.push(joinText(`${s.stationName}역`, s.lines.join("·"), m(s.distanceMeters)));
    if (s.arrivalStatus === "unavailable") {
      lines.push("  실시간 도착 조회 실패.");
    } else if (s.arrivals.length === 0) {
      lines.push("  도착 예정 열차 없음.");
    } else {
      for (const a of s.arrivals) lines.push(`  ${subwayArrivalLine(a)}`);
    }
  }
  return lines;
}

function busArrivalLine(a: BusArrivalItem): string {
  return joinText(
    a.routeNo,
    a.routeType,
    a.arrivalMessage ?? `${Math.round(a.arrivalSeconds / 60)}분 후, ${a.prevStationCount}정류장 전`,
    a.lowFloor && "저상",
  );
}

function formatNearbyBus(body: { stops: BusStopItem[] }): string[] {
  if (body.stops.length === 0) return ["주변에 버스 정류소가 없습니다."];
  const lines: string[] = [];
  for (const s of body.stops) {
    lines.push(joinText(s.name, s.stopNo && `${s.stopNo}번`, m(s.distanceMeters)));
    if (s.arrivalStatus === "unavailable") {
      lines.push("  실시간 도착 조회 실패.");
    } else if (s.arrivals.length === 0) {
      lines.push("  도착 예정 버스 없음.");
    } else {
      for (const a of s.arrivals) lines.push(`  ${busArrivalLine(a)}`);
    }
  }
  return lines;
}

function formatBike(body: { stations: BikeStationItem[] }): string[] {
  if (body.stations.length === 0) return ["주변에 따릉이 대여소가 없습니다."];
  return body.stations.map((b) =>
    joinText(b.name, `자전거 ${b.bikesAvailable}대`, `거치대 ${b.racksTotal}대`, m(b.distanceMeters)),
  );
}

function formatClinics(body: { clinics: NightClinicItem[] }): string[] {
  if (body.clinics.length === 0) return ["주변에 소아 야간·휴일 진료 기관이 없습니다."];
  return body.clinics.map((c) => {
    const statusText =
      c.openStatus.state === "open" ? "진료중" : c.openStatus.state === "closed" ? "진료 종료" : undefined;
    return joinText(c.name, c.kind, statusText, c.phone, c.address, m(c.distanceMeters));
  });
}

function formatAround(body: { places: SurroundingPlaceItem[] }): string[] {
  if (body.places.length === 0) return ["주변 정보가 없습니다."];
  return body.places.map(surroundingLine);
}

function formatBarrierFreeNearby(body: { places: BarrierFreePlaceItem[] }): string[] {
  if (body.places.length === 0) return ["주변에 무장애 관광지가 없습니다."];
  const lines: string[] = [];
  for (const p of body.places) {
    lines.push(joinText(p.name, p.category, p.address, m(p.distanceMeters)));
    lines.push(`상세: gil place barrier-free ${p.contentId}`);
  }
  return lines;
}

// ── 역명 기반 조회 ──────────────────────────────────────────────────────

function formatStationMeta(body: { meta: StationMetaItem | null }): string[] {
  const meta = body.meta;
  if (!meta) return ["역 정보를 찾을 수 없습니다."];
  // A3 seed는 "역" 접미사가 있는 역/없는 역 혼재(서울역·강동) — 중복 접미("서울역역") 방지.
  const displayName = meta.name.endsWith("역") ? meta.name : `${meta.name}역`;
  return [joinText(`${displayName} (${meta.nameEn})`, meta.lines.join("·"), meta.isTransfer && "환승역", meta.operator)];
}

function formatStationFacilities(body: { facilities: StationFacilitiesItem | null }): string[] {
  const f = body.facilities;
  if (!f) return ["시설 정보 없음."];
  const line = joinText(
    typeof f.elevators === "number" ? `엘리베이터 ${f.elevators}대` : undefined,
    typeof f.wheelchairLifts === "number" ? `휠체어 리프트 ${f.wheelchairLifts}대` : undefined,
    f.accessibleToilet && "장애인 화장실",
    f.accessibleSlope && "경사로",
  );
  return line.length > 0 ? [line] : ["시설 정보 없음."];
}

function formatMetroFacilities(body: { facilities: SeoulMetroFacilitiesItem | null }): string[] {
  const f = body.facilities;
  if (!f || f.groups.length === 0) return ["교통약자 시설 정보가 없습니다."];
  const lines: string[] = [];
  for (const g of f.groups) {
    lines.push(`${METRO_KIND_KO[g.kind]}: ${g.facilities.length}개`);
    for (const fac of g.facilities) {
      lines.push(joinText(fac.name, fac.location, fac.floors, fac.operatingStatus === "stopped" && "가동 중지"));
    }
  }
  return lines;
}

function formatSubwayArrival(body: { arrivals: SubwayStationArrivalsItem | null }): string[] {
  const data = body.arrivals;
  if (!data) return ["이 역은 실시간 도착 정보 제공 대상이 아닙니다."];
  if (data.arrivals.length === 0) return ["도착 예정 열차 없음."];
  return data.arrivals.map(subwayArrivalLine);
}

function formatBusRouteStops(body: { stops: BusRouteStopItem[] }): string[] {
  if (body.stops.length === 0) return ["경유 정류소 정보가 없습니다."];
  return body.stops.map((s) => `${s.order}. ${s.name}`);
}

// ── 길찾기 ──────────────────────────────────────────────────────────────

/** envelope 없음 — body 자체가 CarRouteBriefing(카탈로그 envelope: ""). */
function formatRouteCar(body: CarRouteBriefingItem): string[] {
  const lines: string[] = [
    joinText(
      `${(body.distanceMeters / 1000).toFixed(1)}km`,
      `약 ${Math.round(body.durationSeconds / 60)}분`,
      `택시 약 ${body.taxiFare.toLocaleString()}원`,
      body.tollFare > 0 && `통행료 ${body.tollFare.toLocaleString()}원`,
    ),
  ];
  body.guides.forEach((g, i) => {
    lines.push(joinText(`${i + 1}. ${g.guidance}`, m(g.distanceMeters)));
  });
  return lines;
}

function transitSummaryLine(r: TransitRouteItem): string {
  return joinText(
    `약 ${r.summary.totalMinutes}분`,
    `요금 ${r.summary.fare.toLocaleString()}원`,
    `환승 ${r.summary.transfers}회`,
    `도보 ${r.summary.walkMinutes}분`,
  );
}

function transitLegLine(leg: TransitLegItem): string {
  if (leg.mode === "walk") return `도보 ${leg.minutes}분`;
  return joinText(`${leg.lineName} ${leg.fromName}→${leg.toName}`, `${leg.stationCount}개 역`, `${leg.minutes}분`);
}

function formatRouteTransit(body: { result: TransitRouteResultItem | null }): string[] {
  const result = body.result;
  if (!result) return ["대중교통 경로를 찾을 수 없습니다."];
  const lines: string[] = [];
  const pushRoute = (label: string, route: TransitRouteItem) => {
    lines.push(label);
    lines.push(transitSummaryLine(route));
    for (const leg of route.legs) lines.push(transitLegLine(leg));
  };
  pushRoute("추천 경로", result.recommended);
  result.alternatives.forEach((alt, i) => pushRoute(`대안 경로 ${i + 1}`, alt));
  return lines;
}

// ── 날씨·공기질·위치정위·웹검색 ─────────────────────────────────────────

function formatWeather(body: { weather: WeatherItem | null }): string[] {
  const w = body.weather;
  // 200 + null = 키 부재/그리드 미커버(graceful) — upstream 조회 실패(502)와 다른 문장.
  if (!w) return ["날씨 정보가 제공되지 않습니다."];
  const line = joinText(
    SKY_KO[w.sky.label],
    PRECIP_KO[w.precipitation.label],
    typeof w.tempC === "number" && `현재 ${w.tempC}도`,
    typeof w.tempMax === "number" && `최고 ${w.tempMax}`,
    typeof w.tempMin === "number" && `최저 ${w.tempMin}`,
    typeof w.humidity === "number" && `습도 ${w.humidity}%`,
    typeof w.precipProbability === "number" && `강수확률 ${w.precipProbability}%`,
    `${w.baseTime} 기준`,
  );
  return [line];
}

function pollutantLine(label: string, p: AirPollutantItem): string {
  const gradeText = p.grade === "unknown" ? "측정 정보 없음" : AIR_GRADE_KO[p.grade];
  return joinText(`${label} ${gradeText}`, p.value !== null && `${p.value}`);
}

function formatAirQuality(body: { air: AirQualityItem | null }): string[] {
  const a = body.air;
  if (!a) return ["공기질 정보가 제공되지 않습니다."];
  return [
    `${a.stationName} 측정소, ${a.distanceKm}km, ${a.dataTime}`,
    pollutantLine("통합", a.khai),
    pollutantLine("미세먼지", a.pm10),
    pollutantLine("초미세먼지", a.pm25),
  ];
}

function formatWhereAmI(body: { data: WhereAmIItem | null }): string[] {
  const d = body.data;
  if (!d) return ["현재 위치 정보가 제공되지 않습니다."];
  const lines: string[] = [];
  const placeText = d.region || d.address?.road || d.address?.jibun;
  if (placeText) lines.push(placeText);
  if (d.nearestStation) {
    const ns = d.nearestStation;
    lines.push(joinText(`가까운 역: ${ns.name}`, ns.line, `${m(ns.distanceMeters)} ${COMPASS_KO[ns.bearing]}`));
  }
  for (const lm of d.landmarks) lines.push(surroundingLine(lm));
  return lines.length > 0 ? lines : ["현재 위치 정보를 확인할 수 없습니다."];
}

function formatWebSearch(body: { web: WebSearchResultItem[] }): string[] {
  if (body.web.length === 0) return ["검색 결과가 없습니다."];
  const lines: string[] = [];
  body.web.forEach((r, i) => {
    lines.push(r.title, r.snippet, r.url);
    if (i < body.web.length - 1) lines.push("");
  });
  return lines;
}

function formatBarrierFreeDetail(body: { detail: BarrierFreeDetailItem | null }): string[] {
  const d = body.detail;
  if (!d) return ["이 장소의 편의시설 정보가 제공되지 않습니다."];
  if (d.facilities.length === 0) return [d.name, "등록된 편의시설 정보가 없습니다."];
  return [d.name, ...d.facilities.map((f) => `${f.label}: ${f.value}`)];
}

// ── 레지스트리(키는 endpoint-catalog-shared.ts의 name과 일치) ───────────

export const FORMATTERS: Record<string, (data: never) => string[]> = {
  "places-search": formatPlaces,
  "attractions-search": formatPlaces,
  "address-search": formatAddresses,
  "web-search": formatWebSearch,
  "nearby-subway": formatNearbySubway,
  "nearby-bus": formatNearbyBus,
  "nearby-bike": formatBike,
  "nearby-clinic": formatClinics,
  "nearby-kids": formatKids,
  "nearby-around": formatAround,
  "nearby-barrier-free": formatBarrierFreeNearby,
  "station-meta": formatStationMeta,
  "station-facilities": formatStationFacilities,
  "station-metro-facilities": formatMetroFacilities,
  "subway-arrival": formatSubwayArrival,
  "bus-route-stops": formatBusRouteStops,
  "route-car": formatRouteCar,
  "route-transit": formatRouteTransit,
  "weather": formatWeather,
  "air-quality": formatAirQuality,
  "where-am-i": formatWhereAmI,
  "barrier-free-detail": formatBarrierFreeDetail,
};
