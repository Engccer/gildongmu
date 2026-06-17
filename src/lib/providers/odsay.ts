import { env } from "../env";
import type { TransitLeg, TransitRoute, TransitRouteResult } from "../types";

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
  error?: unknown;
}

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
  // 거리·시간 0 도보 구간은 의미 없으니 제외
  const legs = path.subPath
    .filter(
      (sp) =>
        !(
          sp.trafficType === 3 &&
          (sp.sectionTime ?? 0) === 0 &&
          (sp.distance ?? 0) === 0
        ),
    )
    .map(toLeg);
  const boardCount = legs.filter((l) => l.mode !== "walk").length;
  const walkMinutes = legs
    .filter((l) => l.mode === "walk")
    .reduce((sum, l) => sum + l.minutes, 0);
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
  const paths = data.result?.path ?? [];
  if (paths.length === 0) return null;
  const routes = paths.slice(0, 3).map(toTransitRoute);
  return { recommended: routes[0], alternatives: routes.slice(1) };
}
