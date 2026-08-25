import { joinText } from "./output.js";
import { directionParticle, subjectParticle, topicParticle } from "./korean-particle.js";

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
  /** closed=운행 시간 밖(firstTime 동반) / unknown=실시간 미제공 — "열차 없음"과 구분 */
  arrivalStatus: "ok" | "unavailable" | "closed" | "unknown";
  arrivals: SubwayArrivalItem[];
  /** 다음 첫차 "HH:MM"(closed일 때만) */
  firstTime?: string;
}

/** 반경 안에 역이 0건일 때만 실리는 최근접 역(반경 밖이라 목록과 섞지 않는다). */
interface NearestSubwayStationItem {
  stationName: string;
  lines: string[];
  distanceMeters: number;
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

interface AudioSignalSiteItem {
  distanceMeters: number;
  bearing: Bearing;
  deviceCount: number;
}

interface WalkAudioSignalsItem {
  /** 반경 내 기기 총수(sites 최대 5에 잘리기 전 값). */
  deviceCount: number;
  sites: AudioSignalSiteItem[];
  baseDate: string;
}

interface WalkFeatureItem {
  crossing: boolean;
  crossingSignal: "yes" | "no" | "unknown";
  tactilePaving: boolean;
  hostFeature?: "busStop" | "subwayEntrance";
  distanceMeters: number;
  bearing: Bearing;
}

interface WalkOsmItem {
  features: WalkFeatureItem[];
  /** crossing·tactile 각 projection의 cap 전 실개수("N곳 중 가까운 M곳"). */
  crossingTotal: number;
  tactileTotal: number;
}

/** discriminated union — count류는 ok 안에만(unsupported·error에 수치 합성 금지). */
type WalkSourceStatusItem<T> =
  | { status: "ok"; data: T }
  | { status: "unsupported"; reason: "outsideSeoul" | "outsideKorea" }
  | { status: "error" };

interface WalkInfrastructureItem {
  audioSignals: WalkSourceStatusItem<WalkAudioSignalsItem>;
  osm: WalkSourceStatusItem<WalkOsmItem>;
}

interface CongestionAreaItem {
  code: string;
  name: string;
  /** 등급어 원문(서울시가 단계를 늘려도 빈 값이 되지 않게 열거형으로 좁히지 않는다). */
  level: string;
  /** `AREA_CONGEST_MSG` 완성 문장 — 낭독 정본(재조합 금지). 빈 문자열일 수 있다. */
  message: string;
  asOf: string;
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

interface TimetableTrainItem {
  time: string;
  nextDay?: true;
  terminus: string;
}

interface TimetableDirectionItem {
  direction: "up" | "down";
  first: TimetableTrainItem;
  last: TimetableTrainItem;
}

interface TimetableLineItem {
  lineName: string;
  /** ok | noTrains | unknown | unavailable — ok만 directions가 비지 않는다(웹 TimetableLineCoverage 미러) */
  coverage: "ok" | "noTrains" | "unknown" | "unavailable";
  directions: TimetableDirectionItem[];
}

interface StationTimetableItem {
  dailyType: "weekday" | "saturday" | "sunday";
  partial?: true;
  lines: TimetableLineItem[];
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

type MetroFacilityGroupKind = MetroFacilityKind | "voiceGuide" | "elevatorLocation";

interface MetroFacilityItem {
  name: string;
  location: string | undefined;
  floors: string | undefined;
  detail: string | undefined;
  operatingStatus: "normal" | "stopped" | undefined;
}

interface MetroFacilityGroupItem {
  kind: MetroFacilityGroupKind;
  facilities: MetroFacilityItem[];
}

interface SeoulMetroFacilitiesItem {
  groups: MetroFacilityGroupItem[];
  supplementFailed?: true;
}

interface CarRouteGuideItem {
  guidance: string;
  distanceMeters: number;
}

/** 경유지 도착 지점(N4) — `via` 요청 응답에만. steps[stepIndex]가 경유지에서 시작하는 첫 단계. */
interface RouteWaypointItem {
  stepIndex: number;
  coord: { lat: number; lng: number };
}

interface CarRouteBriefingItem {
  distanceMeters: number;
  durationSeconds: number;
  taxiFare: number;
  tollFare: number;
  guides: CarRouteGuideItem[];
  waypoint?: RouteWaypointItem;
}

interface TransitLegItem {
  mode: "walk" | "bus" | "subway";
  lineName?: string;
  fromName?: string;
  toName?: string;
  /** 도보 구간 거리(미터). 3-state: 필드가 없으면 "정보 없음"이라 0m로 채우지 않는다. */
  distanceMeters?: number;
  stationCount?: number;
  intervalMinutes?: number;
  minutes: number;
  serviceStatus?: "running" | "outside" | "unknown";
  firstServiceTime?: string;
  lastServiceTime?: string;
  /** 하차역 빠른하차 문 위치(E5). 판정 불가·미커버·시설 없음은 필드 부재. */
  quickExit?: QuickExitItem;
}

interface QuickExitDoorItem {
  kind: "door" | "between";
  doors: string[];
}

interface QuickExitItem {
  /** 환승 leg의 빠른환승 문(A20). 있으면 elevator·stairs 대신 이 문장만 낸다. */
  transfer?: QuickExitDoorItem;
  elevator?: QuickExitDoorItem;
  stairs?: QuickExitDoorItem;
}

interface TransitRouteItem {
  summary: { totalMinutes: number; fare: number; transfers: number; walkMinutes: number };
  legs: TransitLegItem[];
  /** 1순위보다 나은 축(둘 다일 수 있어 배열). 서버가 판정한다. */
  highlight?: ("fastest" | "fewestTransfers")[];
  /** 축 라벨이 없는 대안의 표시 번호(1부터). 서버가 정해 3플랫폼 갈림을 막는다. */
  displayIndex?: number;
}

interface TransitRouteResultItem {
  recommended: TransitRouteItem;
  alternatives: TransitRouteItem[];
}

interface WalkRouteStepItem {
  description: string;
}

interface WalkRouteBriefingItem {
  distanceMeters: number;
  durationSeconds: number;
  steps: WalkRouteStepItem[];
  waypoint?: RouteWaypointItem;
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

/** `/api/nearby/overview` 응답(웹 `src/lib/nearby-overview.ts` 미러). */
interface OverviewPlaceItem { name: string; distanceMeters: number; bearing: Bearing }
type OverviewBusStopsItem =
  | { state: "ok"; count: number; nearest: OverviewPlaceItem[] }
  | { state: "none" } | { state: "uncovered" } | { state: "failed" };
type OverviewBulletItem =
  | { kind: "transit"; state: "ok"; station: { name: string; line?: string; bearing: Bearing; distanceMeters: number } | null; busStops: OverviewBusStopsItem | null }
  | { kind: "food" | "cafe" | "kids" | "events" | "barrierFree"; state: "ok"; count: number; countCapped: boolean; nearest: OverviewPlaceItem[] }
  | { kind: "food" | "cafe" | "kids" | "events" | "barrierFree"; state: "none" }
  | { kind: "events"; state: "unavailable"; reason: "seoulOnly" }
  | { kind: "food" | "cafe" | "kids" | "events" | "barrierFree"; state: "failed" };
interface NearbyOverviewItem { place: string | null; radiusMeters: number; bullets: OverviewBulletItem[] }

interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

// ── 공통 헬퍼 ───────────────────────────────────────────────────────────

const m = (n: number): string => `${Math.round(n)}m`;

/**
 * 적응형 거리: 1km 미만은 미터, 그 이상은 "{km}km {m}m"(웹 `formatDistance` 미러).
 * `m()`은 도보권 항목(정류소·역) 전용이라 수십 km에 쓰면 "89700m"가 되어
 * 낭독으로 크기를 가늠할 수 없다.
 *
 * ⚠ 웹·Kit과 **문자열이 byte 단위로 같아야 한다**(드리프트 가드가 강제). 100m 단위
 * 반올림을 먼저 하는 이유는 1,999m가 "1km 1000m"이 되는 자리올림을 막기 위해서다.
 */
export const dist = (n: number): string => {
  const rounded = Math.round(n);
  if (rounded < 1000) return `${rounded}m`;
  // 1km 이상은 소수 km(위원장 지시 2026-08-02, 웹 formatDistance 미러).
  return `${rounded / 1000}km`;
};

const COMPASS_KO: Record<Bearing, string> = {
  n: "북", ne: "북동", e: "동", se: "남동", s: "남", sw: "남서", w: "서", nw: "북서",
};

const KIDS_KIND_KO: Record<KidsPlaceItem["kind"], string> = {
  kidscafe: "키즈카페", playground: "놀이터", playcenter: "놀이센터", park: "어린이공원",
};

const METRO_KIND_KO: Record<MetroFacilityGroupKind, string> = {
  elevator: "엘리베이터", escalator: "에스컬레이터", wheelchairLift: "휠체어 리프트",
  movingWalk: "무빙워크", wheelchairCharger: "전동휠체어 급속충전기",
  safetyPlatform: "안전발판", signLangPhone: "수어영상전화기",
  helper: "교통약자 도우미", restroom: "장애인 화장실",
  voiceGuide: "시각장애인 음성유도기", elevatorLocation: "엘리베이터 위치",
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

// 웹 messages/ko.json timetable.* 카피와 동일 유지(CLI 산문 미러).
const DAILY_TYPE_KO: Record<StationTimetableItem["dailyType"], string> = {
  weekday: "평일 기준", saturday: "토요일 기준", sunday: "일요일·공휴일 기준",
};
// 웹 timetable.coverage.* 미러. "확인 불가"≠"편성 없음"≠"조회 실패" — 세 문장이 같으면
// 0행 노선을 남긴 의미(A19)가 없다.
const COVERAGE_KO: Record<Exclude<TimetableLineItem["coverage"], "ok">, (line: string) => string> = {
  unknown: (line) => `${line} 오늘 시간표를 확인할 수 없습니다.`,
  unavailable: (line) => `${line} 시간표를 불러오지 못했습니다.`,
  noTrains: (line) => `${line} 오늘 탑승할 수 있는 편성이 없습니다.`,
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

// ── 장소 검색 ───────────────────────────────────────────────────────

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

interface CultureEventItem {
  title: string;
  category: string;
  place: string;
  district: string;
  dateText: string;
  timeText: string;
  isFree: boolean;
  fee?: string;
  target: string;
  distanceMeters: number;
}

function formatEvents(body: { events: CultureEventItem[] }): string[] {
  if (body.events.length === 0) return ["주변에 오늘 진행 중인 문화행사가 없습니다."];
  return body.events.map((e) =>
    joinText(
      e.title,
      e.category,
      joinText(e.place, e.district),
      e.dateText,
      e.timeText,
      e.isFree ? "무료" : joinText("유료", e.fee),
      e.target,
      m(e.distanceMeters),
    ),
  );
}

// ── 내 주변(좌표 기반) ──────────────────────────────────────────────────

function formatNearbySubway(body: {
  stations: NearbySubwayStationItem[];
  nearest?: NearestSubwayStationItem;
}): string[] {
  if (body.stations.length === 0) {
    // 0건이어도 최근접 역 거리를 알린다 — 걸어갈 만한 거리인지(강동 1.5km)
    // 도시철도가 없는 지역인지(강릉 90km) 이 수치가 가른다.
    if (!body.nearest) return ["주변에 지하철역이 없습니다."];
    const n = body.nearest;
    // joinText로 앞 문장까지 잇지 않는다 — 조각마다 쉼표가 끼어 "가장 가까운 역은,
    // 정동진역"으로 낭독된다. 역 정보만 합치고 문장은 템플릿으로 조립한다.
    const label = joinText(`${n.stationName}역`, n.lines.join("·"), dist(n.distanceMeters));
    return [`주변에 지하철역이 없습니다. 가장 가까운 역은 ${label} 거리입니다.`];
  }
  const lines: string[] = [];
  for (const s of body.stations) {
    lines.push(joinText(`${s.stationName}역`, s.lines.join("·"), m(s.distanceMeters)));
    if (s.arrivalStatus === "unavailable") {
      lines.push("  실시간 도착 조회 실패.");
    } else if (s.arrivalStatus === "closed" && s.firstTime) {
      lines.push(`  운행 시간이 아님. 첫차 ${s.firstTime}.`);
    } else if (s.arrivalStatus === "closed" || s.arrivalStatus === "unknown") {
      lines.push("  실시간 도착 정보 미제공.");
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

/** 그룹 헤더: cap에 잘렸으면 "N곳 중 가까운 M곳", 아니면 "N곳"(웹 walkInfra.group* 카피 미러). */
function walkGroupHeader(label: string, total: number, listed: number): string {
  return total > listed ? `${label} ${total}곳 중 가까운 ${listed}곳` : `${label} ${total}곳`;
}

/**
 * 두 소스(audioSignals·osm)를 서로 독립 판정(웹 WalkInfraNearby 상태×산문 매트릭스 미러).
 * 3-state: "0곳"(등록 없음) ≠ unsupported(제공 지역 밖) ≠ error(조회 실패)를 각자
 * 다른 문장으로 낭독한다. 両소스 error는 라우트가 503으로 끊어 여기 오지 않는다.
 */
function formatWalkInfra(body: { walk: WalkInfrastructureItem }): string[] {
  const { audioSignals, osm } = body.walk;
  const lines: string[] = [];

  if (audioSignals.status === "ok") {
    if (audioSignals.data.deviceCount > 0) {
      lines.push(`음향신호기 반경 300m 안 ${audioSignals.data.deviceCount}기`);
      for (const site of audioSignals.data.sites) {
        lines.push(`  ${COMPASS_KO[site.bearing]} ${m(site.distanceMeters)}(${site.deviceCount}기)`);
      }
    } else {
      lines.push("반경 300m 안에 등록된 음향신호기가 없습니다.");
    }
  } else if (audioSignals.status === "unsupported") {
    lines.push("음향신호기 정보는 서울만 제공됩니다.");
  } else {
    lines.push("음향신호기 정보를 불러오지 못했습니다.");
  }

  if (osm.status === "ok") {
    const crossing = osm.data.features.filter((f) => f.crossing);
    const tactile = osm.data.features.filter((f) => !f.crossing && f.tactilePaving);
    if (osm.data.crossingTotal > 0) {
      lines.push(walkGroupHeader("횡단보도", osm.data.crossingTotal, crossing.length));
      for (const f of crossing) {
        lines.push(`  ${joinText(
          `${COMPASS_KO[f.bearing]} ${m(f.distanceMeters)}`,
          f.crossingSignal === "yes" && "신호등 있음",
          f.tactilePaving && "점자블록 있음",
        )}`);
      }
    } else {
      lines.push("주변에 등록된 횡단보도가 없습니다.");
    }
    if (osm.data.tactileTotal > 0) {
      lines.push(walkGroupHeader("점자블록", osm.data.tactileTotal, tactile.length));
      for (const f of tactile) {
        lines.push(`  ${joinText(
          `${COMPASS_KO[f.bearing]} ${m(f.distanceMeters)}`,
          f.hostFeature === "busStop" && "버스정류장",
          f.hostFeature === "subwayEntrance" && "지하철 출입구",
        )}`);
      }
    } else {
      lines.push("주변에 등록된 점자블록이 없습니다.");
    }
  } else if (osm.status === "unsupported") {
    // 국내 전역 정적 seed라 한국 밖은 실패가 아니라 미제공이다(3-state). 그룹 이름을
    // 각 문장에 넣어야 연속 낭독에서 두 줄이 중복으로 들리지 않는다.
    // ⚠ 이 문장은 정의상 한국 밖에서만 들리므로 "국내" 같은 상대어를 쓰지 않는다
    // (기준점이 화자인지 청자인지 문장 안에서 확정되지 않는다). 웹 walkInfra.*Unsupported 카피.
    lines.push("횡단보도 정보는 한국에서만 제공됩니다.");
    lines.push("점자블록 정보는 한국에서만 제공됩니다.");
  } else {
    lines.push("횡단보도·점자블록 정보를 불러오지 못했습니다.");
  }

  // 등록 기준 각주(정직성 표기는 API 계층 계약, 웹 walkInfra.footnote·source* 카피).
  // 출처는 실제로 데이터를 보여준 소스만 인용한다.
  if (audioSignals.status === "ok" || osm.status === "ok") {
    lines.push("서울시·OSM 등록 자료 기준으로, 실제 시설 유무나 작동 상태와 다를 수 있습니다.");
    lines.push(joinText(
      osm.status === "ok" && "© OpenStreetMap 기여자",
      audioSignals.status === "ok" && `음향신호기: 서울특별시 제공(${audioSignals.data.baseDate} 기준)`,
    ));
  }
  return lines;
}

/**
 * 200 + area null = 서울시가 혼잡도를 재는 121곳 밖(서울의 91%가 여기 해당) —
 * **오류가 아니다**. 조회 실패는 502라 여기 오지 않는다(3-state).
 * 등급어·완성 문장은 API가 한국어 원문만 주므로 그대로 통과시킨다.
 */
function formatCongestion(body: { area: CongestionAreaItem | null }): string[] {
  const a = body.area;
  if (!a) return ["이 지역은 실시간 혼잡도 제공 대상이 아닙니다."];
  const lines = [joinText(`${a.name} 혼잡도 ${a.level}`, a.asOf && `${a.asOf} 기준`)];
  // 완성 문장은 별도 줄(재조합 금지). 빈 문자열이면 줄 자체를 만들지 않는다.
  if (a.message) lines.push(a.message);
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
  // groups 전멸이어도 supplementFailed면 non-null로 온다(실패 은폐 금지) — 빈 배열+플래그 조합 보존.
  if (!f || (f.groups.length === 0 && !f.supplementFailed)) return ["교통약자 시설 정보가 없습니다."];
  const lines: string[] = [];
  for (const g of f.groups) {
    lines.push(`${METRO_KIND_KO[g.kind]}: ${g.facilities.length}개`);
    for (const fac of g.facilities) {
      const line = joinText(fac.name, fac.location, fac.floors, fac.detail, fac.operatingStatus === "stopped" && "가동 중지");
      if (line) lines.push(line);
    }
  }
  if (f.supplementFailed) lines.push("일부 시설 정보를 불러오지 못했습니다.");
  return lines;
}

function timetableTrainText(label: string, t: TimetableTrainItem): string {
  const time = `${label} ${t.nextDay ? "익일 " : ""}${t.time}`;
  return t.terminus ? `${time} ${t.terminus}행` : time;
}

/** 200 + null = TAGO 미커버 역·키 없음(라우트 판정 표) — 조회 실패(502)와 다른 문장. */
function formatStationTimetable(body: { timetable: StationTimetableItem | null }): string[] {
  const tt = body.timetable;
  if (!tt) return ["이 역은 첫차·막차 정보 제공 대상이 아닙니다."];
  const lines: string[] = [
    joinText(DAILY_TYPE_KO[tt.dailyType], tt.partial && "일부 노선 정보를 불러오지 못했습니다."),
  ];
  for (const line of tt.lines) {
    if (line.coverage !== "ok") {
      // 계약 밖 값(서버가 CLI 발행본보다 앞설 때)은 "확인 불가"로(웹·iOS 동형)
      lines.push((COVERAGE_KO[line.coverage] ?? COVERAGE_KO.unknown)(line.lineName));
      continue;
    }
    for (const d of line.directions) {
      lines.push(joinText(
        `${line.lineName} ${d.direction === "up" ? "상행" : "하행"}`,
        timetableTrainText("첫차", d.first),
        timetableTrainText("막차", d.last),
      ));
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
      dist(body.distanceMeters),
      `약 ${Math.round(body.durationSeconds / 60)}분`,
      `택시 약 ${body.taxiFare.toLocaleString()}원`,
      body.tollFare > 0 && `통행료 ${body.tollFare.toLocaleString()}원`,
    ),
  ];
  body.guides.forEach((g, i) => {
    if (body.waypoint?.stepIndex === i) lines.push(WAYPOINT_LINE);
    lines.push(joinText(`${i + 1}. ${g.guidance}`, g.distanceMeters > 0 ? m(g.distanceMeters) : undefined));
  });
  return lines;
}

/** 경유지 구획 한 줄(N4). CLI는 경유지 이름을 모르므로(좌표로 조회) 이름 없이. 번호 흐름은 깨지 않는다. */
const WAYPOINT_LINE = "경유지 도착";

function transitSummaryLine(r: TransitRouteItem): string {
  return joinText(
    `약 ${r.summary.totalMinutes}분`,
    `요금 ${r.summary.fare.toLocaleString()}원`,
    `환승 ${r.summary.transfers}회`,
    `도보 ${r.summary.walkMinutes}분`,
  );
}

/**
 * 도보 구간 한 줄(spec §4.3). `toName`은 그 뒤 첫 탑승 구간의 승차역이고, 마지막
 * 도보에는 없다. 이름을 몰라도 "목적지까지"라는 구간 의미는 항상 안다. CLI는
 * 목적지 이름을 알지 못하므로(좌표로도 조회된다) 이름 주입 분기를 두지 않는다.
 */
function transitWalkLegLine(leg: TransitLegItem): string {
  // 거리 필드 부재 = 정보 없음 → 거리 없는 문구로 떨어진다(0m로 둔갑 금지).
  return joinText(
    `${leg.toName ?? "목적지"}까지 도보 ${leg.minutes}분`,
    typeof leg.distanceMeters === "number" && dist(leg.distanceMeters),
  );
}

/**
 * 대안 표시 이름(spec §4.1). 축 라벨도 번호도 서버 판정을 옮기기만 한다.
 * 번호를 CLI가 세면 웹·iOS와 갈리고 그 갈림을 잡는 테스트가 없다.
 */
function transitAlternativeName(route: TransitRouteItem): string {
  const fastest = route.highlight?.includes("fastest") ?? false;
  const fewestTransfers = route.highlight?.includes("fewestTransfers") ?? false;
  if (fastest && fewestTransfers) return "가장 빠르고 환승도 가장 적은 경로";
  if (fewestTransfers) return "환승이 가장 적은 경로";
  if (fastest) return "가장 빠른 경로";
  // 축도 번호도 없는 응답은 스키마 위반이다. 없는 번호를 지어내지 않는다.
  return typeof route.displayIndex === "number" ? `대안 경로 ${route.displayIndex}` : "대안 경로";
}

/**
 * 빠른하차 문장(E5). 웹 `quickExitText` + `messages/ko.json`의 ko 미러다 — CLI는 i18n이
 * 없어 문구를 옮겨 적을 수밖에 없고, 갈리면 같은 사실이 화면마다 다르게 낭독된다.
 * 동조는 `format-drift.test.ts`가 웹 정본을 실행해 대조로 강제한다(`dist()` 동형).
 */
function quickExitDoorPhrase(door: QuickExitDoorItem): string | null {
  if (door.kind === "between" && door.doors.length >= 2) {
    return `${door.doors[0]} 문과 ${door.doors[1]} 문 사이`;
  }
  return door.doors[0] ? `${door.doors[0]} 문` : null;
}

export function transitQuickExitLine(leg: TransitLegItem): string | null {
  if (!leg.quickExit || !leg.toName) return null;
  const transfer = leg.quickExit.transfer ? quickExitDoorPhrase(leg.quickExit.transfer) : null;
  if (transfer) return `${leg.toName} 하차, 빠른 환승 ${transfer}`;
  const elevator = leg.quickExit.elevator ? quickExitDoorPhrase(leg.quickExit.elevator) : null;
  const stairs = leg.quickExit.stairs ? quickExitDoorPhrase(leg.quickExit.stairs) : null;
  if (elevator && stairs) {
    return `${leg.toName} 하차, 엘리베이터 ${elevator}, 계단 ${stairs}`;
  }
  if (elevator) return `${leg.toName} 하차, 엘리베이터 ${elevator}`;
  if (stairs) return `${leg.toName} 하차, 계단 ${stairs}`;
  return null;
}

function transitLegLine(leg: TransitLegItem): string {
  if (leg.mode === "walk") return transitWalkLegLine(leg);
  return joinText(
    `${leg.lineName} ${leg.fromName}→${leg.toName}`,
    `${leg.stationCount}개 역`,
    `${leg.minutes}분`,
    typeof leg.intervalMinutes === "number" && `배차간격 약 ${leg.intervalMinutes}분`,
    // 운행 밖만 표기(정상·정보없음은 침묵). joinText가 falsy 조각을 걸러 준다.
    leg.serviceStatus === "outside" &&
      !!leg.firstServiceTime &&
      !!leg.lastServiceTime &&
      `첫차 ${leg.firstServiceTime}, 막차 ${leg.lastServiceTime}, 지금은 운행하지 않음`,
  );
}

function formatRouteTransit(body: {
  result: TransitRouteResultItem | null;
  /** 경유지 요청(N4): ODsay에 경유지가 없어 서버가 upstream 없이 마커로 답한다 — "경로 없음"과 다른 문장. */
  unsupported?: "waypoint";
}): string[] {
  if (body.unsupported === "waypoint") return ["경유지는 대중교통 경로에서 지원하지 않습니다."];
  const result = body.result;
  if (!result) return ["대중교통 경로를 찾을 수 없습니다."];
  const lines: string[] = [];
  const pushRoute = (label: string, route: TransitRouteItem) => {
    lines.push(label);
    lines.push(transitSummaryLine(route));
    for (const leg of route.legs) {
      lines.push(transitLegLine(leg));
      // 별도 문장이라 별도 줄(웹이 별도 블록으로 두는 것과 같은 판단).
      const quickExit = transitQuickExitLine(leg);
      if (quickExit) lines.push(quickExit);
    }
  };
  pushRoute("추천 경로", result.recommended);
  for (const alt of result.alternatives) pushRoute(transitAlternativeName(alt), alt);
  return lines;
}

/** envelope "result" — 서버가 만든 완성 문장(description)을 재조합 없이 그대로.
 *  ⚠ 2026-08-07부터 이 문장은 provider 원문이 아니라 `rewriteWalkGuidance` 재작성본이라
 *  거리·도로명이 이미 안에 있다(단계 번호만 여기서 붙인다).
 *  null = 3102 경로 없음(라우트 200 graceful) — 조회 실패(502)와 다른 문장(3-state). */
function formatRouteWalk(body: { result: WalkRouteBriefingItem | null }): string[] {
  const r = body.result;
  if (!r) return ["도보 경로를 찾을 수 없습니다."];
  const lines: string[] = [
    joinText(dist(r.distanceMeters), `약 ${Math.round(r.durationSeconds / 60)}분`),
  ];
  r.steps.forEach((s, i) => {
    if (r.waypoint?.stepIndex === i) lines.push(WAYPOINT_LINE);
    lines.push(`${i + 1}. ${s.description}`);
  });
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

const OVERVIEW_LABEL_KO = { food: "식당", cafe: "카페", kids: "아이 놀 곳", events: "문화 행사", barrierFree: "무장애 관광지" } as const;

/** 장소명 + (으)로. 비한글 장소명은 조사 판정 불가라 쉼표로 물러난다("GS25, 남쪽 40m"). */
function asDestination(name: string): string {
  const particle = directionParticle(name);
  return particle === null ? `${name},` : `${name}${particle}`;
}

function overviewNearest(items: OverviewPlaceItem[]): string {
  return `가장 가까운 곳은 ${items.map((p) => `${asDestination(p.name)} ${COMPASS_KO[p.bearing]}쪽 ${dist(p.distanceMeters)}`).join(", ")}입니다.`;
}

/**
 * 한눈에 보기 — 불릿당 문장 묶음, 상태별 문장이 전부 다르다(3-state 불변식: 0건 ≠ 정보 없음 ≠ 실패).
 * Kit `buildOverviewLines`와 같은 구조(ko 고정, 문장형은 위원장 판정 2026-08-22).
 */
function formatNearbyOverview(body: { data: NearbyOverviewItem | null }): string[] {
  const d = body.data;
  if (!d) return ["주변 정보가 제공되지 않습니다."];
  const lines: string[] = [];
  if (d.place) lines.push(`현재 위치 기준, ${d.place} 근처`);
  lines.push(`한눈에 보기 (${dist(d.radiusMeters)} 안)`);
  for (const b of d.bullets) {
    if (b.kind === "transit") {
      const parts: string[] = [];
      const bus = b.busStops;
      parts.push(
        b.station
          ? `가장 가까운 지하철역은 ${b.station.line ? `${b.station.line} ` : ""}${asDestination(b.station.name)} ${COMPASS_KO[b.station.bearing]}쪽 ${dist(b.station.distanceMeters)}입니다.`
          : `${dist(d.radiusMeters)} 안에 지하철역이 없습니다.`,
      );
      if (bus) {
        if (bus.state === "ok") parts.push(`버스 정류소가 ${bus.count}곳 있습니다. ${overviewNearest(bus.nearest)}`);
        else if (bus.state === "none") parts.push("버스 정류소가 없습니다.");
        else if (bus.state === "uncovered") parts.push("버스 정류소 정보는 이 지역에서 제공되지 않습니다.");
        else parts.push("버스 정류소 정보를 가져오지 못했습니다.");
      }
      lines.push(parts.join(" "));
      continue;
    }
    const label = OVERVIEW_LABEL_KO[b.kind];
    if (b.state === "ok") lines.push(`${label}${subjectParticle(label)} ${b.count}곳${b.countCapped ? " 이상" : ""} 있습니다. ${overviewNearest(b.nearest)}`);
    else if (b.state === "none") lines.push(`${label}${topicParticle(label)} ${dist(d.radiusMeters)} 안에 없습니다.`);
    else if (b.state === "unavailable") lines.push(`${label}${topicParticle(label)} 서울에서만 안내합니다.`);
    else lines.push(`${label} 정보를 가져오지 못했습니다.`);
  }
  return lines;
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
  "address-search": formatAddresses,
  "web-search": formatWebSearch,
  "nearby-subway": formatNearbySubway,
  "nearby-bus": formatNearbyBus,
  "nearby-bike": formatBike,
  "nearby-clinic": formatClinics,
  "nearby-kids": formatKids,
  "nearby-around": formatAround,
  "nearby-events": formatEvents,
  "nearby-barrier-free": formatBarrierFreeNearby,
  "nearby-walk-infra": formatWalkInfra,
  "nearby-congestion": formatCongestion,
  "station-meta": formatStationMeta,
  "station-facilities": formatStationFacilities,
  "station-metro-facilities": formatMetroFacilities,
  "station-timetable": formatStationTimetable,
  "subway-arrival": formatSubwayArrival,
  "bus-route-stops": formatBusRouteStops,
  "route-car": formatRouteCar,
  "route-transit": formatRouteTransit,
  "route-walk": formatRouteWalk,
  "weather": formatWeather,
  "air-quality": formatAirQuality,
  "where-am-i": formatWhereAmI,
  "nearby-overview": formatNearbyOverview,
  "barrier-free-detail": formatBarrierFreeDetail,
};
