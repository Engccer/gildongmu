import { env } from "../env";
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
}
interface OdsaySubPath {
  trafficType: number; // 1=지하철, 2=버스, 3=도보
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  startName?: string;
  endName?: string;
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
    minutes,
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
    SX: String(origin.lng),
    SY: String(origin.lat),
    EX: String(dest.lng),
    EY: String(dest.lat),
    OPT: "0",
  });
  // apiKey는 인코딩하지 않고 raw로 덧붙인다(이중 인코딩 방지)
  const url = `${ENDPOINT}?${q.toString()}&apiKey=${env.ODSAY_API_KEY ?? ""}`;

  const res = await fetch(url, {
    // 경로는 준정적 — 같은 좌표쌍 캐시로 1,000회/일 쿼터를 보호
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODsay 길찾기 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as OdsayResponse;
  // error 분기(경로없음 graceful vs 장애 throw)는 normalizeOdsayRoute가 담당.
  return normalizeOdsayRoute(data);
}
