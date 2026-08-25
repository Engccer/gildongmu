import { env } from "../env";
import { roundCoord } from "../coord-round";
import { judgeServiceStatus, kstNowMinutes, type ServiceStatus } from "../service-hours";
import { fetchServiceHoursMap, type ServiceHours } from "./bus-service-hours";
import { isNoRouteError, readOdsayError } from "./odsay-envelope";
import { findQuickExit } from "../quick-exit";
import { normalizeStationName } from "../station-match";
import { annotateHighlights, isOutside, selectTransitRoutes } from "./odsay-select";
import { fetchSubwayServiceHoursMap, subwayHoursKey } from "./subway-service-hours";
import type {
  Coord,
  TransitLeg,
  TransitLegStop,
  TransitRoute,
  TransitRouteResult,
} from "../types";

/**
 * ODsay 대중교통 길찾기 provider.
 *
 * api.odsay.com/v1/api/searchPubTransPathT 의 path/subPath 응답을
 * 길동무 자체 TransitRoute shape로 정규화해 ODsay 종속을 격리한다.
 * 정규화는 순수 함수(normalizeOdsayRoute)라 fixture로 결정적 테스트한다.
 *
 * ⚠ 필드명/단위/에러코드는 pre-merge 실호출로 확정(설계 §2). 단위는 문서 기준
 *   totalTime/sectionTime=분, payment=원, totalWalk=미터.
 */

const ENDPOINT = "https://api.odsay.com/v1/api/searchPubTransPathT";

interface OdsayLane {
  name?: string; // 지하철 노선명
  busNo?: string; // 버스 번호
  busLocalBlID?: string; // 지역 사업자 노선 ID(서울은 TOPIS busRouteId와 동일 값)
  busCityCode?: number; // ODsay 도시 코드(서울=1000)
}
// 경유 정류장(passStopList) 한 항목 — 실호출 확정(2026-08-04 프로브):
// 버스는 localStationID(서울=TOPIS stId 동일값)·arsID 보유, 지하철은 stationID·이름·좌표만.
interface OdsayPassStop {
  stationID?: number | string;
  stationName?: string;
  stationCityCode?: number | string;
  localStationID?: string;
  arsID?: string;
  x?: string | number; // 경도
  y?: string | number; // 위도
}
interface OdsaySubPath {
  trafficType: number; // 1=지하철, 2=버스, 3=도보
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  intervalTime?: number; // 평균 배차간격(분) — 실호출 확정(2026-07-21 길동→강남, 지하철 5·8·2호선 10/5/5)
  startName?: string;
  endName?: string;
  wayCode?: number; // 지하철 방향 1=상행·2=하행 — 실호출 양방향 확정(2026-08-01)
  /**
   * 빠른환승 문("5-2"). ⚠ **환승 leg에만** 값이 있고 하차 leg는 문자열 `"null"`이다
   * (실호출 2026-08-25 사당→구로디지털단지 `"null"`, 노원→서울역 `"10-4"`). 카카오지하철 표기와 일치.
   */
  door?: string;
  lane?: OdsayLane[];
  passStopList?: { stations?: OdsayPassStop[] };
}
interface OdsayPath {
  pathType: number;
  info: {
    totalTime: number;
    payment: number;
    totalWalk?: number;
    firstStartStation?: string;
    lastEndStation?: string;
  };
  subPath: OdsaySubPath[];
}
export interface OdsayResponse {
  result?: { path?: OdsayPath[] };
  /** ⚠ 객체와 배열 두 모양으로 온다. 직접 읽지 말고 readOdsayError를 쓴다 */
  error?: unknown;
}

/** 좌표 파싱 — 빈 문자열은 NaN(⚠ Number("")===0 함정, coord-param 계열). */
function coordNum(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** passStopList → TransitLegStop[] (좌표·이름 유효 항목만, 양 끝 포함 순서 보존). */
function toLegStops(sp: OdsaySubPath): TransitLegStop[] {
  const stations = sp.passStopList?.stations;
  if (!Array.isArray(stations)) return [];
  return stations.flatMap((st): TransitLegStop[] => {
    const name = String(st.stationName ?? "").trim();
    const lat = coordNum(st.y);
    const lng = coordNum(st.x);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const stationId = st.stationID == null ? "" : String(st.stationID);
    const cityCode = st.stationCityCode == null ? "" : String(st.stationCityCode);
    return [
      {
        name,
        ...(stationId ? { stationId } : {}),
        ...(st.localStationID ? { localId: String(st.localStationID) } : {}),
        ...(st.arsID ? { arsId: String(st.arsID) } : {}),
        ...(cityCode ? { cityCode } : {}),
        lat,
        lng,
      },
    ];
  });
}

/** 유한한 0 이상 수만 통과. 그 외는 undefined(3-state: 0으로 채우지 않는다) */
function walkDistance(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}

/**
 * 하차역 직전 정차역 — 빠른하차 방향 판정의 유일한 단서.
 *
 * ⚠ `includeStops`와 무관하게 원본 `passStopList`에서 읽는다(그 플래그는 방출만 통제한다).
 * ⚠ 목록 마지막이 하차역인지 **확인하고** 쓴다: 순서가 뒤집혔거나 부분 목록이면
 *   "끝에서 두 번째"가 직전역이 아니고, 그때 나오는 값은 반대편 승강장 안내가 된다.
 */
function previousStopName(sp: OdsaySubPath): string | null {
  const stations = sp.passStopList?.stations;
  if (!Array.isArray(stations) || stations.length < 2) return null;
  const last = String(stations[stations.length - 1]?.stationName ?? "").trim();
  const end = String(sp.endName ?? "").trim();
  if (!last || !end || normalizeStationName(last) !== normalizeStationName(end)) return null;
  const previous = String(stations[stations.length - 2]?.stationName ?? "").trim();
  return previous || null;
}

/** ODsay `door` → 문. `"null"` 문자열·빈 값·미지 표기는 전부 부재(긍정 매칭만 통과, A20). */
function transferDoor(raw: unknown): string | null {
  return typeof raw === "string" && /^\d+-\d+$/.test(raw) ? raw : null;
}

/**
 * 탑승 leg의 하차 종류(A20). 빠른하차 값의 **소스가 종류마다 다르다**.
 * - `transfer`: ODsay가 빠른환승 문을 줬다 → 그 문 하나가 정본.
 * - `inStationTransfer`: 문은 없는데 다음 탑승이 지하철이고 그 사이 도보가 전부 역내(0m)다
 *   → seed 계단은 출구용일 수 있어 **아무것도 싣지 않는다**(거짓보다 침묵).
 * - `final`: 그 외(마지막 탑승·버스로 환승·역 밖 도보) → seed 엘리베이터·계단.
 */
type AlightKind = "transfer" | "inStationTransfer" | "final";

function alightKindAt(subPath: OdsaySubPath[], index: number): AlightKind {
  if (transferDoor(subPath[index]?.door)) return "transfer";
  for (let j = index + 1; j < subPath.length; j++) {
    const next = subPath[j];
    if (next.trafficType === 3) {
      if ((next.distance ?? 0) === 0) continue;
      return "final";
    }
    return next.trafficType === 1 ? "inStationTransfer" : "final";
  }
  return "final";
}

function quickExitFor(sp: OdsaySubPath, kind: AlightKind) {
  if (kind === "transfer") {
    const door = transferDoor(sp.door)!;
    return { transfer: { kind: "door" as const, doors: [door] } };
  }
  if (kind === "inStationTransfer") return null;
  const lane = sp.lane?.[0];
  return lane?.name && sp.endName
    ? findQuickExit({
        stationName: sp.endName,
        lineName: lane.name,
        previousStopName: previousStopName(sp),
      })
    : null;
}

function toLeg(sp: OdsaySubPath, includeStops: boolean, alightKind: AlightKind): TransitLeg {
  const minutes = sp.sectionTime ?? 0;
  if (sp.trafficType === 3) {
    const distanceMeters = walkDistance(sp.distance);
    // toName은 toTransitRoute가 뒤 첫 탑승 구간에서 유도해 채운다
    return { mode: "walk", minutes, ...(distanceMeters != null ? { distanceMeters } : {}) };
  }
  const mode = sp.trafficType === 1 ? "subway" : "bus";
  const lane = sp.lane?.[0];
  const stops = includeStops ? toLegStops(sp) : [];
  const quickExit = mode === "subway" ? quickExitFor(sp, alightKind) : null;
  return {
    mode,
    lineName: mode === "subway" ? lane?.name : lane?.busNo,
    fromName: sp.startName,
    toName: sp.endName,
    stationCount: sp.stationCount,
    // 0은 "정보 없음"으로 취급해 생략(3-state: 배차 0분은 존재하지 않는 값)
    intervalMinutes: sp.intervalTime || undefined,
    minutes,
    // 운행시간 조인 키. 서울은 TOPIS ID 직결, 지방은 TAGO 번호 검색 후 대조라
    // 도시 코드가 함께 필요하다(bus-service-hours가 분기).
    ...(mode === "bus" && lane?.busLocalBlID && lane?.busCityCode != null
      ? { serviceRouteId: lane.busLocalBlID, serviceCityCode: lane.busCityCode }
      : {}),
    // 지하철은 공유 식별자가 없어 (역명, 노선명, 방향)으로 시간표를 맞춘다.
    ...(mode === "subway" && sp.wayCode != null ? { serviceWayCode: sp.wayCode } : {}),
    // 옵트인 시에만 키 자체가 생긴다(미지정 응답 byte-호환, B2 §7).
    ...(stops.length > 0 ? { stops } : {}),
    // 판정 불가·미커버·시설 없음은 전부 키 부재(3-state, E5 §7).
    ...(quickExit ? { quickExit } : {}),
  };
}

function toTransitRoute(path: OdsayPath, includeStops: boolean, routeKey: string): TransitRoute {
  // 거리 0 도보는 역내 환승 통로다(실호출 검증: {trafficType:3, distance:0,
  // sectionTime:1~3}). 환승은 노선 전환·transfers로 이미 표현되므로 leg
  // 리스트에서는 제외해 낭독을 간결히 한다. 단 walkMinutes(총 도보 시간)는
  // 환승 통로 시간도 실제 걷는 시간이라 필터 전 전체 도보 합으로 정직하게 센다.
  // ⚠ 하차 종류는 필터 **전** 원본 인덱스로 판정한다 — 역내 환승 통로(0m 도보)가 판정의 단서다.
  const legs = path.subPath
    .map((sp, i) => ({ sp, kind: alightKindAt(path.subPath, i) }))
    .filter(({ sp }) => !(sp.trafficType === 3 && (sp.distance ?? 0) === 0))
    .map(({ sp, kind }) => toLeg(sp, includeStops, kind));

  // 도보 구간의 행선지 유도: 그 뒤 첫 탑승 구간의 fromName.
  // ⚠ 환승 통로 필터 **뒤**의 배열에서 돈다. 필터 전에 돌면 0m 통로가 사이에 끼어
  //   첫 도보가 환승역을 가리킨다. 뒤에 탑승 구간이 없으면(마지막 도보) 설정하지
  //   않고, 그 자리는 소비자가 목적지 의미로 채운다(spec §4.3).
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mode !== "walk") continue;
    const next = legs.slice(i + 1).find((l) => l.mode !== "walk");
    if (next?.fromName) legs[i] = { ...legs[i], toName: next.fromName };
  }

  const boardCount = legs.filter((l) => l.mode !== "walk").length;
  const walkMinutes = path.subPath
    .filter((sp) => sp.trafficType === 3)
    .reduce((sum, sp) => sum + (sp.sectionTime ?? 0), 0);
  return {
    summary: {
      totalMinutes: path.info.totalTime,
      fare: path.info.payment,
      transfers: Math.max(0, boardCount - 1),
      walkMinutes,
      departName: path.info.firstStartStation,
      arriveName: path.info.lastEndStation,
    },
    legs,
    routeKey,
  };
}

/**
 * ODsay 응답 → 전체 TransitRoute 배열. 경로 없음이면 null.
 *
 * ⚠ 3-state: "경로 없음"(null)과 "조회 실패"(throw)를 가른다. 종전
 *   `data.result?.path ?? []`는 result 자체가 없는 응답을 "경로 없음"으로 바꿔
 *   장애를 사용자에게 "대중교통 경로가 없습니다"로 전달했다.
 *
 * ⚠ 선정(5개)은 여기서 하지 않는다. 강등이 전체 후보에 먼저 적용돼야
 *   선정 밖의 유일한 운행 중 경로를 놓치지 않는다(spec §3.3).
 */
export function normalizeOdsayRoutes(
  data: OdsayResponse,
  opts?: { includeStops?: boolean },
): TransitRoute[] | null {
  const err = readOdsayError(data.error);
  if (err) {
    // 출·도착 700m 이내 등 "경로 없음"류는 장애가 아니라 graceful(null).
    // 그 외 오류(인증·파라미터·서버)는 throw해 라우트가 502로 정직하게 알린다.
    if (isNoRouteError(err.code)) return null;
    throw new Error(`ODsay 길찾기 오류: ${err.code} ${err.message}`);
  }
  const paths = data.result?.path;
  if (!Array.isArray(paths)) {
    throw new Error("ODsay 응답 스키마 위반: result.path가 배열이 아닙니다");
  }
  if (paths.length === 0) return null;
  return paths.map((p, i) => toTransitRoute(p, opts?.includeStops === true, `p${i}`));
}

function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 운행시간 판정을 leg에 싣고 경로를 강등 정렬한다(순수).
 *
 * 정렬 키는 **`outside` 유무 하나**다(A21). `unknown`은 정렬에 참여하지 않는다 — 조회 실패·
 * 미커버를 결함으로 단정하면 멀쩡한 경로가 강등되고, 선정 5개 절단과 결합하면 강등이 곧
 * 제외가 된다(TAGO 4호선 0행으로 ODsay 1순위가 사라진 실사고). 안정 정렬이라 그 밖에는
 * ODsay 추천순이 보존된다.
 *
 * ⚠ 버스·지하철 leg는 조인 키가 없어도 반드시 상태를 갖는다(조회 불가는 unknown).
 *   정렬엔 안 쓰지만 `unknown` 표기 3-state는 상태가 있어야 성립한다.
 */
export function annotateServiceStatus(
  routes: TransitRoute[],
  busHours: Map<string, ServiceHours>,
  subwayHours: Map<string, ServiceHours>,
  nowMinutes: number,
): TransitRoute[] {
  const hoursFor = (leg: TransitLeg): ServiceHours | undefined => {
    if (leg.mode === "bus") {
      return leg.serviceRouteId ? busHours.get(leg.serviceRouteId) : undefined;
    }
    if (!leg.fromName || !leg.lineName || leg.serviceWayCode == null) return undefined;
    return subwayHours.get(
      subwayHoursKey({
        stationName: leg.fromName,
        lineName: leg.lineName,
        wayCode: leg.serviceWayCode,
      }),
    );
  };

  const annotateRoute = (route: TransitRoute): TransitRoute => ({
    ...route,
    legs: route.legs.map((leg) => {
      if (leg.mode === "walk") return leg;
      const h = hoursFor(leg);
      const status: ServiceStatus = h
        ? judgeServiceStatus(nowMinutes, h.firstMinutes, h.lastMinutes)
        : "unknown";
      return {
        ...leg,
        serviceStatus: status,
        ...(h?.firstMinutes != null ? { firstServiceTime: formatHHMM(h.firstMinutes) } : {}),
        ...(h?.lastMinutes != null ? { lastServiceTime: formatHHMM(h.lastMinutes) } : {}),
      };
    }),
  });

  const routeRank = (route: TransitRoute): number => (isOutside(route) ? 1 : 0);

  const all = routes.map(annotateRoute);
  // 안정 정렬이라 같은 rank 안에서는 ODsay 추천순이 보존된다
  return [...all].sort((a, b) => routeRank(a) - routeRank(b));
}

/**
 * ODsay 대중교통 길찾기 조회. 경로 없으면 null, ODsay 오류/HTTP 실패면 throw.
 *
 * ⚠ apiKey는 이미 URL 인코딩된 값일 수 있어 재인코딩하면 깨진다 →
 *   URLSearchParams로 인코딩하지 말고 raw로 쿼리에 붙인다.
 * ODsay 좌표 파라미터는 SX/EX=경도(lng), SY/EY=위도(lat).
 */
export async function getTransitRoute(params: {
  origin: Coord;
  dest: Coord;
  /** 경유 정류장 옵트인(B2 §7) — 응답 팽창 방지 위해 웹·iOS 클라이언트만 요청. */
  includeStops?: boolean;
}): Promise<TransitRouteResult | null> {
  const { origin, dest } = params;
  const q = new URLSearchParams({
    SX: roundCoord(origin.lng, 4),
    SY: roundCoord(origin.lat, 4),
    EX: roundCoord(dest.lng, 4),
    EY: roundCoord(dest.lat, 4),
    OPT: "0",
  });
  // apiKey는 인코딩하지 않고 raw로 덧붙인다(이중 인코딩 방지)
  const url = `${ENDPOINT}?${q.toString()}&apiKey=${env.ODSAY_API_KEY ?? ""}`;

  const res = await fetch(url, {
    // ODsay URI(도메인) 플랫폼 식별 — 콘솔에 등록된 도메인과 일치해야 한다.
    // Vercel 서버리스는 egress IP가 가변이라 Server(IP) 방식이 프로덕션에서 인증 실패
    // → 기존 앱에 URI 환경을 병행 등록하고 서버 fetch가 Referer를 명시한다(dev/prod 동일 경로).
    headers: { Referer: "https://gildongmu.vercel.app/" },
    // 경로는 준정적, 같은 좌표쌍 캐시로 1,000회/일 쿼터를 보호.
    // 좌표는 4자리 반올림으로 캐시 키 안정화(측위마다 키가 달라지는 것 방지)
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODsay 길찾기 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as OdsayResponse;
  // 0단계 정규화(전체). 봉투 3-state는 normalizeOdsayRoutes가 담당한다.
  const routes = normalizeOdsayRoutes(data, { includeStops: params.includeStops });
  if (!routes) return null;

  // 1단계 강등(전체). ⚠ 선정보다 **먼저** 돈다: 선정 밖의 유일한 운행 중 경로를
  // 못 보는 결함을 막는다. 시간표 조회는 노선·역 단위 중복 제거 + 24시간 캐시라
  // 전체 적용 비용이 방어할 값이 아니다(spec §3.3).
  // ODsay는 출발 시각을 반영하지 않아 심야에도 주간 노선을 추천한다
  // (2026-08-01 실측: 03:58에 6개 대안 전부 운행 시간 밖). 조회가 실패해도 경로는
  // 그대로 반환한다 — 부가 정보가 본 기능을 죽이면 고치려다 더 큰 회귀가 된다.
  const allLegs = routes.flatMap((r) => r.legs);
  const refs = allLegs.flatMap((l) =>
    l.serviceRouteId && l.serviceCityCode != null
      ? [{ localId: l.serviceRouteId, cityCode: l.serviceCityCode, routeNo: l.lineName ?? "" }]
      : [],
  );
  const subwayRefs = allLegs.flatMap((l) =>
    l.mode === "subway" && l.fromName && l.lineName && l.serviceWayCode != null
      ? [{ stationName: l.fromName, lineName: l.lineName, wayCode: l.serviceWayCode }]
      : [],
  );
  const [busHours, subwayHours] = await Promise.all([
    fetchServiceHoursMap(refs),
    fetchSubwayServiceHoursMap(subwayRefs),
  ]);
  const ranked = annotateServiceStatus(routes, busHours, subwayHours, kstNowMinutes(new Date()));

  // 2단계 선정 → 3단계 라벨. 순서를 바꾸면 축의 기준점이 낡는다.
  return annotateHighlights(selectTransitRoutes(ranked), ranked.length);
}
