import { env } from "../env";
import { summarizeCongestion, type CongestionPiece } from "../car-traffic";
import type { CarRouteBriefing, CarRouteGuide, Coord, RouteWaypoint } from "../types";

/**
 * 카카오모빌리티 자동차 길찾기(Directions) provider.
 *
 * 엔드포인트: https://apis-navi.kakaomobility.com/v1/directions
 * 인증: 카카오 로컬과 동일한 REST 키 (KakaoAK 헤더) — 별도 활성화 불필요
 * (2026-06-13 실호출 검증: 서울역→경복궁 guides 10단계 정상 수신).
 *
 * 이 provider의 목적은 지도 폴리라인이 아니라 **턴바이턴 텍스트 브리핑**이다.
 * 응답의 guides[].guidance가 이미 완성된 한국어 안내문
 * ("염천교에서 서대문역 방면으로 좌회전")이므로 그대로 정본 텍스트로 쓴다.
 * roads(도로 조각)는 정체 옵트인(E80 `traffic`)일 때만 받는다(`road_details=true`) — 그 밖엔 요청 자체를 끈다.
 *
 * 주의: 좌표 파라미터는 "경도,위도"(x,y) 순서. 이 파일 밖은 lat/lng 도메인.
 * 경유지는 `waypoints`(실호출 확정 2026-08-22): sections가 2개로 갈리고 경유지
 * guide(`type 1000`)가 section 0 끝과 section 1 첫머리에 **중복** 등장한다.
 */

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

interface KakaoNaviGuide {
  name: string;
  guidance: string;
  distance: number;
  duration: number;
  type: number;
  x?: number;
  y?: number;
}

export interface KakaoNaviRoute {
  result_code: number;
  result_msg: string;
  summary: {
    distance: number;
    duration: number;
    fare: { taxi: number; toll: number };
  };
  sections: Array<{ guides?: KakaoNaviGuide[]; roads?: KakaoNaviRoad[] }>;
}

/** 도로 조각(`road_details=true`일 때, E80). 거리 m, 속도 km/h, `vertexes`는 [x,y,x,y,…] 평탄 배열. */
interface KakaoNaviRoad {
  name: string;
  distance: number;
  traffic_speed: number;
  traffic_state: number;
  vertexes: number[];
}

interface KakaoNaviResponse {
  routes: KakaoNaviRoute[];
}

/** 경유지 guide type(카카오모빌리티 문서·실호출 2026-08-22). */
const WAYPOINT_GUIDE_TYPE = 1000;

export function normalizeRoute(
  route: KakaoNaviRoute,
  opts?: {
    /** waypoints를 보냈다 — type 1000 guide가 없으면 파라미터 무시로 보고 throw(N4).
     *  중복 guide(section 경계 양쪽)는 하나로 접는다. 미지정이면 현행 평탄화 그대로. */
    expectWaypoint?: boolean;
  },
): CarRouteBriefing {
  const guides: CarRouteGuide[] = [];
  let waypoint: RouteWaypoint | undefined;
  for (const section of route.sections) {
    for (const g of section.guides ?? []) {
      if (opts?.expectWaypoint && g.type === WAYPOINT_GUIDE_TYPE) {
        if (waypoint) continue; // section 1 첫머리의 중복 경유지 guide
        const coord =
          typeof g.x === "number" && typeof g.y === "number" ? { lat: g.y, lng: g.x } : undefined;
        if (!coord) throw new Error("카카오모빌리티 길찾기 실패: 경유지 guide에 좌표 없음");
        waypoint = { stepIndex: guides.length, coord };
      }
      guides.push({
        name: g.name,
        guidance: g.guidance,
        distanceMeters: g.distance,
        durationSeconds: g.duration,
      });
    }
  }
  if (opts?.expectWaypoint && !waypoint) {
    throw new Error("카카오모빌리티 길찾기 실패: 경유지 요청인데 경유지 guide 없음(파라미터 무시 의심)");
  }
  return {
    distanceMeters: route.summary.distance,
    durationSeconds: route.summary.duration,
    taxiFare: route.summary.fare.taxi,
    tollFare: route.summary.fare.toll,
    guides,
    ...(waypoint ? { waypoint } : {}),
  };
}

/**
 * 카카오모빌리티 교통 상태 코드표(공식 레퍼런스 2026-11-07): 0 정보 없음 · 1 정체 · 2 지체 · 3 서행 · 4 원활 ·
 * 6 교통사고(통행 불가). ⚠ 숫자가 작을수록 막힌다 — Tmap(4가 정체)과 반대. 6은 관측 0건이고 "정체"와 뜻이 달라
 * 이번엔 정보 없음으로 둔다(spec §1).
 */
function kakaoLevel(state: number): { known: boolean; jam: boolean } {
  // 6 교통사고(통행 불가)는 정체보다 나쁘다 — 정보 없음으로 접으면 그 구간이 「막히는 곳 없음」의 근거가 된다.
  if (state === 1 || state === 2 || state === 6) return { known: true, jam: true };
  if (state === 3 || state === 4) return { known: true, jam: false };
  return { known: false, jam: false };
}

/** 카카오 경로 → 경로 순서의 교통 조각(E80 §3 ①). 조각 길이는 `distance`, 좌표는 `vertexes` 첫·끝. */
export function kakaoCongestionPieces(route: KakaoNaviRoute): CongestionPiece[] {
  const pieces: CongestionPiece[] = [];
  let along = 0;
  for (const section of route.sections) {
    for (const r of section.roads ?? []) {
      const v = r.vertexes ?? [];
      const len = Number.isFinite(r.distance) && r.distance > 0 ? r.distance : 0;
      if (len > 0 && v.length >= 4) {
        const { known, jam } = kakaoLevel(r.traffic_state);
        pieces.push({
          fromM: along,
          toM: along + len,
          known,
          jam,
          road: r.name ? r.name : null,
          from: { lat: v[1], lng: v[0] },
          to: { lat: v[v.length - 1], lng: v[v.length - 2] },
        });
      }
      along += len;
    }
  }
  return pieces;
}

/**
 * 자동차 경로 텍스트 브리핑 조회.
 * result_code 0이 아니면(경로 없음·출발/도착 동일 등) result_msg를 담아 throw.
 */
export async function getCarRouteBriefing(params: {
  origin: Coord;
  dest: Coord;
  /** 경유지 1개(N4) — waypoints "lng,lat". */
  via?: Coord;
  /** 정체 구간 옵트인(E80). 거짓이면 요청·응답 모두 종전과 같다(`road_details=false`). */
  traffic?: boolean;
}): Promise<CarRouteBriefing> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("origin", `${params.origin.lng},${params.origin.lat}`);
  url.searchParams.set("destination", `${params.dest.lng},${params.dest.lat}`);
  if (params.via) url.searchParams.set("waypoints", `${params.via.lng},${params.via.lat}`);
  url.searchParams.set("summary", "false");
  url.searchParams.set("road_details", params.traffic ? "true" : "false");

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    // 실시간 교통이 반영되는 응답이라 캐시하지 않는다
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오모빌리티 길찾기 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as KakaoNaviResponse;
  const route = data.routes?.[0];
  if (!route) {
    throw new Error("카카오모빌리티 길찾기 실패: 응답에 경로 없음");
  }
  if (route.result_code !== 0) {
    throw new Error(
      `카카오모빌리티 경로 탐색 실패 (${route.result_code}): ${route.result_msg}`,
    );
  }
  const briefing = normalizeRoute(route, { expectWaypoint: params.via !== undefined });
  if (!params.traffic) return briefing;
  // 정체 해석 실패는 경로를 깨지 않는다(spec §2 — 정보 없음으로 접는다).
  let congestion: CarRouteBriefing["congestion"] = null;
  try {
    congestion = summarizeCongestion(kakaoCongestionPieces(route), briefing.distanceMeters);
  } catch {
    congestion = null;
  }
  return { ...briefing, congestion };
}
