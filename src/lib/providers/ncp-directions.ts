import { env } from "../env";
import type { CarRouteBriefing, CarRouteGuide, Coord } from "../types";

/**
 * NCP Maps Directions(5) 자동차 길찾기 provider — **영문 턴바이턴 정본**.
 *
 * 카카오모빌리티 directions는 한국어 안내문만 주므로(ko 전용), 외국인 영문
 * UI(en 로케일)의 "자동차 경로 미리 듣기"는 이 provider로 라우팅한다. NCP는
 * `lang=en`이 완전한 영문 턴바이턴(`instructions`)을 반환한다(2026-06-17 실호출
 * 검증: 서울역→경복궁 "Turn right toward 'Cheongpa-ro'" …). 라우트 선택은
 * `/api/route/car`가 lang+키 유무로 디스패치(en+NCP키 → 여기, 그 외 → 카카오).
 *
 * - 엔드포인트: https://maps.apigw.ntruss.com/map-direction/v1/driving
 * - 인증 헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key (서버 전용, ncp-geocode와 동형)
 * - 좌표 파라미터는 "경도,위도"(lng,lat) 순서. 이 파일 밖은 lat/lng 도메인.
 * - option=trafast(실시간 빠른길). 목적은 폴리라인이 아니라 텍스트 브리핑이라
 *   path/section은 쓰지 않고 summary+guide만 정규화한다.
 *
 * ⚠ 단위 함정: NCP `duration`은 **밀리초**(summary·guide 모두)인데
 * 카카오·CarRouteBriefing.durationSeconds는 **초**다. 정규화에서 반드시
 * /1000 변환(아니면 28분이 468시간으로 낭독됨).
 */

const ENDPOINT = "https://maps.apigw.ntruss.com/map-direction/v1/driving";

interface NcpDrivingGuide {
  instructions: string;
  distance: number;
  duration: number;
  pointIndex: number;
  type: number;
}

interface NcpDrivingSummary {
  distance: number;
  duration: number;
  taxiFare: number;
  tollFare: number;
}

/** option=trafast 경로 하나(summary + guide). 정규화 입력 단위. */
export interface NcpDrivingRoute {
  summary: NcpDrivingSummary;
  guide: NcpDrivingGuide[];
}

interface NcpDrivingResponse {
  code: number;
  message: string;
  route?: { trafast?: NcpDrivingRoute[] };
}

/** 밀리초 → 초(반올림). 카카오/CarRouteBriefing 단위 정합. */
function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function normalizeNcpRoute(route: NcpDrivingRoute): CarRouteBriefing {
  const guides: CarRouteGuide[] = route.guide.map((g) => ({
    // NCP guide엔 카카오의 name(랜드마크)+guidance(문장) 2필드가 없고
    // instructions 단일 완성 문장만 있다 → guidance로, name은 빈 문자열.
    name: "",
    guidance: g.instructions,
    distanceMeters: g.distance,
    durationSeconds: msToSeconds(g.duration),
  }));
  return {
    distanceMeters: route.summary.distance,
    durationSeconds: msToSeconds(route.summary.duration),
    taxiFare: route.summary.taxiFare,
    tollFare: route.summary.tollFare,
    guides,
  };
}

/**
 * 영문 자동차 경로 텍스트 브리핑 조회(NCP Directions, lang=en).
 * code가 0이 아니거나(경로 없음 등) 응답에 경로가 없으면 message를 담아 throw.
 */
export async function getCarRouteBriefingEn(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("start", `${params.origin.lng},${params.origin.lat}`);
  url.searchParams.set("goal", `${params.dest.lng},${params.dest.lat}`);
  url.searchParams.set("option", "trafast");
  url.searchParams.set("lang", "en");

  const res = await fetch(url, {
    headers: {
      "x-ncp-apigw-api-key-id": env.NCP_MAPS_CLIENT_ID ?? "",
      "x-ncp-apigw-api-key": env.NCP_MAPS_CLIENT_SECRET ?? "",
    },
    // 실시간 교통이 반영되는 응답이라 캐시하지 않는다(카카오 동형)
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NCP 길찾기 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as NcpDrivingResponse;
  if (data.code !== 0) {
    // 카카오 provider와 동일하게 "경로 탐색 실패" 토큰을 포함해
    // 라우트가 입력성 오류(경로 없음)로 분류할 수 있게 한다.
    throw new Error(`NCP 경로 탐색 실패 (${data.code}): ${data.message}`);
  }
  const route = data.route?.trafast?.[0];
  if (!route) {
    throw new Error("NCP 경로 탐색 실패: 응답에 경로 없음");
  }
  return normalizeNcpRoute(route);
}
