import { env } from "../env";
import { roundCoord } from "../coord-round";
import {
  judgeServiceStatus,
  kstNowMinutes,
  SERVICE_RANK,
  type ServiceStatus,
} from "../service-hours";
import { fetchServiceHoursMap, type ServiceHours } from "./bus-service-hours";
import { fetchSubwayServiceHoursMap, subwayHoursKey } from "./subway-service-hours";
import type { Coord, TransitLeg, TransitRoute, TransitRouteResult } from "../types";

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
interface OdsaySubPath {
  trafficType: number; // 1=지하철, 2=버스, 3=도보
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  intervalTime?: number; // 평균 배차간격(분) — 실호출 확정(2026-07-21 길동→강남, 지하철 5·8·2호선 10/5/5)
  startName?: string;
  endName?: string;
  wayCode?: number; // 지하철 방향 1=상행·2=하행 — 실호출 양방향 확정(2026-08-01)
  lane?: OdsayLane[];
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
  // ODsay는 200 + { error: { code, msg } }로 오류를 주기도 한다(실호출 검증).
  error?: { code?: string | number; msg?: string };
}

// "경로 없음"류로 graceful(null) 처리할 ODsay error 코드.
// -98: 출·도착지가 700m 이내(실호출 검증, 2026-06-18). 다른 경로없음 코드는
// 실제 관측 시 추가한다(추측 금지). 그 외 코드(인증·파라미터·서버 오류)는 throw.
const NO_ROUTE_ERROR_CODES = new Set(["-98"]);

function toLeg(sp: OdsaySubPath): TransitLeg {
  const minutes = sp.sectionTime ?? 0;
  if (sp.trafficType === 3) {
    return { mode: "walk", minutes };
  }
  const mode = sp.trafficType === 1 ? "subway" : "bus";
  const lane = sp.lane?.[0];
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
  };
}

function toTransitRoute(path: OdsayPath): TransitRoute {
  // 거리 0 도보는 역내 환승 통로다(실호출 검증: {trafficType:3, distance:0,
  // sectionTime:1~3}). 환승은 노선 전환·transfers로 이미 표현되므로 leg
  // 리스트에서는 제외해 낭독을 간결히 한다. 단 walkMinutes(총 도보 시간)는
  // 환승 통로 시간도 실제 걷는 시간이라 필터 전 전체 도보 합으로 정직하게 센다.
  const legs = path.subPath
    .filter((sp) => !(sp.trafficType === 3 && (sp.distance ?? 0) === 0))
    .map(toLeg);
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
  };
}

/** ODsay 응답 → TransitRouteResult. 경로 없으면 null(graceful "찾지 못함"). */
export function normalizeOdsayRoute(
  data: OdsayResponse,
): TransitRouteResult | null {
  if (data.error) {
    // 출·도착 700m 이내 등 "경로 없음"류는 장애가 아니라 graceful(null).
    // 그 외 오류(인증·파라미터·서버)는 throw해 라우트가 502로 정직하게 알린다.
    if (NO_ROUTE_ERROR_CODES.has(String(data.error.code ?? ""))) return null;
    throw new Error(`ODsay 길찾기 오류: ${JSON.stringify(data.error)}`);
  }
  const paths = data.result?.path ?? [];
  if (paths.length === 0) return null;
  const routes = paths.slice(0, 3).map(toTransitRoute);
  return { recommended: routes[0], alternatives: routes.slice(1) };
}

function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 운행시간 판정을 leg에 싣고 경로를 강등 정렬한다(순수).
 *
 * 경로 상태 = 그 경로 탑승 leg 중 SERVICE_RANK 최대값.
 *
 * ⚠ 버스·지하철 leg는 조인 키가 없어도 반드시 상태를 갖는다(조회 불가는 unknown).
 *   상태를 안 붙이면 아래 rank 산출이 그 leg를 "판정 대상 아님"으로 세지 않고,
 *   그런 leg만으로 이루어진 경로가 rank 0을 받아 확인된 running 경로와 나란히
 *   최상단에 남는다. rank 0은 **도보 전용 경로**의 몫이다.
 */
export function annotateServiceStatus(
  result: TransitRouteResult,
  busHours: Map<string, ServiceHours>,
  subwayHours: Map<string, ServiceHours>,
  nowMinutes: number,
): TransitRouteResult {
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

  const routeRank = (route: TransitRoute): number => {
    const ranks = route.legs
      .filter((l) => l.serviceStatus != null)
      .map((l) => SERVICE_RANK[l.serviceStatus!]);
    return ranks.length === 0 ? 0 : Math.max(...ranks);
  };

  const all = [result.recommended, ...result.alternatives].map(annotateRoute);
  const sorted = [...all].sort((a, b) => routeRank(a) - routeRank(b));
  return { recommended: sorted[0], alternatives: sorted.slice(1) };
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
  // error 분기(경로없음 graceful vs 장애 throw)는 normalizeOdsayRoute가 담당.
  const normalized = normalizeOdsayRoute(data);
  if (!normalized) return null;

  // 운행시간 보강. ODsay는 출발 시각을 반영하지 않아 심야에도 주간 노선을 추천한다
  // (2026-08-01 실측: 03:58에 6개 대안 전부 운행 시간 밖). 조회가 실패해도 경로는
  // 그대로 반환한다 — 부가 정보가 본 기능을 죽이면 고치려다 더 큰 회귀가 된다.
  const allLegs = [normalized.recommended, ...normalized.alternatives].flatMap((r) => r.legs);
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
  return annotateServiceStatus(normalized, busHours, subwayHours, kstNowMinutes(new Date()));
}
