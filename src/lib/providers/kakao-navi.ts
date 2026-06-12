import { env } from "../env";
import type { CarRouteBriefing, CarRouteGuide, Coord } from "../types";

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
 * roads(폴리라인 좌표)는 요청 자체를 끈다(road_details=false) — 받지도 않는다.
 *
 * 주의: 좌표 파라미터는 "경도,위도"(x,y) 순서. 이 파일 밖은 lat/lng 도메인.
 */

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

interface KakaoNaviGuide {
  name: string;
  guidance: string;
  distance: number;
  duration: number;
  type: number;
}

interface KakaoNaviRoute {
  result_code: number;
  result_msg: string;
  summary: {
    distance: number;
    duration: number;
    fare: { taxi: number; toll: number };
  };
  sections: Array<{ guides?: KakaoNaviGuide[] }>;
}

interface KakaoNaviResponse {
  routes: KakaoNaviRoute[];
}

export function normalizeRoute(route: KakaoNaviRoute): CarRouteBriefing {
  const guides: CarRouteGuide[] = route.sections.flatMap((section) =>
    (section.guides ?? []).map((g) => ({
      name: g.name,
      guidance: g.guidance,
      distanceMeters: g.distance,
      durationSeconds: g.duration,
    })),
  );
  return {
    distanceMeters: route.summary.distance,
    durationSeconds: route.summary.duration,
    taxiFare: route.summary.fare.taxi,
    tollFare: route.summary.fare.toll,
    guides,
  };
}

/**
 * 자동차 경로 텍스트 브리핑 조회.
 * result_code 0이 아니면(경로 없음·출발/도착 동일 등) result_msg를 담아 throw.
 */
export async function getCarRouteBriefing(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("origin", `${params.origin.lng},${params.origin.lat}`);
  url.searchParams.set("destination", `${params.dest.lng},${params.dest.lat}`);
  url.searchParams.set("summary", "false");
  url.searchParams.set("road_details", "false");

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
  return normalizeRoute(route);
}
