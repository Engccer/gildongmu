import { env } from "../env";
import { roundCoord } from "../coord-round";
import type { Coord, RouteWaypoint, WalkRouteBriefing, WalkRouteStep } from "../types";

/**
 * 카카오 도보 경로안내 provider.
 *
 * 엔드포인트: GET https://dapi.kakao.com/v2/routing/walk
 * 인증: 헤더 Authorization: KakaoAK {REST 키}(카카오 로컬·모빌리티 공용 단일 키).
 *
 * 응답 envelope은 실호출 확정(2026-07-22·07-29): top-level `route`가 **단수
 * 객체**(배열 아님)이고 top-level `status` 문자열을 동반한다(data.go.kr류
 * response.body.items 포맷과 무관). `route.legs[].steps[]`의 `properties.guidance`
 * 가 **완성된 한국어 안내문**이다(turnType류 코드 재조합 금지 — 원문은 여기서
 * 손대지 않는다). ⚠ 다만 **낭독 정본은 이 원문이 아니라 walk-route 서비스가
 * `rewriteWalkGuidance`로 재작성한 문장**이다(2026-08-07 계약 전환: 거리·도로명을
 * 문장 안으로, 방향을 앞으로). provider는 원문 전달까지만 책임진다. `path.points`는 스텝 폴리라인
 * [lng, lat] 배열이며, walk-route 서비스가 음향신호기 주석 판정의 후보점으로
 * 쓴 뒤 응답 전 제거한다(pathCoords는 API 응답 비노출).
 *
 * status: "OK" 성공, "TOO_FAR_AWAY"·"ROUTE_RESULT_NOT_FOUND" 2종만 경로 불가로
 * graceful null 처리(실호출 관측분만, 추측 금지) — 그 외 미관측 status는 장애를
 * 경로 없음으로 뭉개지 않도록 throw한다(fail-closed).
 *
 * accessible=true 시 route_mode=ACCESSIBLE(무장애 경로, 실호출 확인) 파라미터를
 * 추가한다. 경유지는 `via_x`/`via_y`(실호출 확정 2026-08-22 — `route.legs`가 2개로
 * 갈린다). ⚠ `waypoints`·`passlist`류 이름은 **무시되고 200 정상 응답**이 오므로
 * 이름 오타는 테스트의 URL 문자열 단언과 legs 수 가드(`expectWaypoint`)만이 잡는다. en 미지원(안내문이 한국어 고정) — V1 ko 전용은 Tmap과 동일 스코프.
 *
 * 캐시: revalidate 3600(보행 경로는 준정적). 좌표는 4자리 반올림으로 캐시 키
 * 안정화(`roundCoord`, route_mode가 URL에 포함되어 모드별 캐시가 자연 분리).
 *
 * ⚠ **accessible 요청만은 반올림하지 않는다**(dodo 역이식 2026-08-23, codex 적대적
 * 리뷰 ②): 반올림은 캐시 키만 바꾸는 것이 아니라 **upstream에 보내는 좌표 자체**를
 * 바꾼다. 4자리 격자는 약 11m인데 지하철 출입구 두 개가 같은 셀에 들어가고, 그
 * 단위가 곧 계단 유무가 갈리는 단위다 — 계단 회피를 켠 사용자에게 다른 출입구
 * 경로를 주면 토글이 무의미해진다. `roundCoord`가 스스로 정한 적용 기준("반올림
 * 오차가 결과를 못 바꾸는 곳에만")을 이 분기만 만족하지 못한다. 카카오 도보는
 * 무과금이라 히트율 하락 비용이 사실상 0이다.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/routing/walk";

/** 경로 불가로 graceful(null) 처리할 status — 실호출 관측분만(추측 금지). */
const NO_ROUTE_STATUSES = new Set(["TOO_FAR_AWAY", "ROUTE_RESULT_NOT_FOUND"]);

interface KakaoWalkStep {
  properties?: { guidance?: string; distance?: number };
  path?: { points?: [number, number][] };
}

export interface KakaoWalkResponse {
  status?: string;
  route?: {
    properties: { totalDistance?: number; totalTime?: number };
    legs?: { steps?: KakaoWalkStep[] }[];
  };
}

/**
 * 카카오 응답 → WalkRouteBriefing 정규화(순수 함수).
 *
 * guidance 없는 스텝(경유점)은 제외, 좌표가 깨진 스텝은 안내문은 살리고
 * pathCoords만 생략한다(주석 판정만 포기 — Tmap coord 생략 원칙 동형). 총
 * 거리/시간이 유한 양수가 아니거나 안내 단계가 0개면 깨진 경로를 확정
 * 낭독하지 않도록 throw한다(3-state 원칙).
 */
export function normalizeKakaoWalkRoute(
  data: KakaoWalkResponse,
  opts?: {
    /** via를 보냈다 — legs가 2개가 아니면 provider가 파라미터를 무시한 것이라 throw. */
    expectWaypoint?: boolean;
    /** leg 경계 좌표를 어느 스텝에서도 못 얻을 때의 최후 폴백(요청 원좌표). */
    via?: Coord;
  },
): WalkRouteBriefing | null {
  const status = data.status;
  if (status !== undefined && status !== "OK") {
    if (NO_ROUTE_STATUSES.has(status)) return null;
    throw new Error(`카카오 도보 경로 실패: 미관측 status ${status}`);
  }
  const route = data.route;
  if (!route) throw new Error("카카오 도보 경로 정규화 실패: route 부재");
  const distanceMeters = route.properties?.totalDistance ?? NaN;
  const durationSeconds = route.properties?.totalTime ?? NaN;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 총 거리 값 이상");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 총 시간 값 이상");
  }
  const steps: WalkRouteStep[] = [];
  const legs = route.legs ?? [];
  let waypoint: RouteWaypoint | undefined;
  if (opts?.expectWaypoint) {
    if (legs.length !== 2) {
      throw new Error(`카카오 도보 경로 실패: 경유지 요청인데 legs ${legs.length}개(파라미터 무시 의심)`);
    }
  }
  for (const [legIndex, leg] of legs.entries()) {
    if (opts?.expectWaypoint && legIndex === 1) {
      // leg 경계 = 경유지. 좌표는 leg 0 끝점 → leg 1 첫 점 → 요청 원좌표 순.
      const coord = legEdgeCoord(legs[0], "last") ?? legEdgeCoord(leg, "first") ?? opts.via;
      if (!coord) throw new Error("카카오 도보 경로 실패: 경유지 좌표를 확정할 수 없음");
      waypoint = { stepIndex: steps.length, coord };
    }
    for (const step of leg.steps ?? []) {
      const description = step.properties?.guidance;
      if (!description) continue;
      const distance = step.properties?.distance;
      // points는 [lng, lat] 순서. 유한 좌표만 pathCoords로 투영, 전멸이면 생략
      // (주석 판정만 포기하고 안내문은 살린다 — Tmap coord 생략 원칙 동형).
      const pathCoords: Coord[] = (step.path?.points ?? [])
        .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng))
        .map(([lng, lat]) => ({ lat, lng }));
      steps.push({
        description,
        // iOS가 distanceMeters를 비옵셔널 Int로 엄격 디코딩한다 — 카카오가 소수를
        // 줄 가능성을 여기서 반올림해 차단(스키마 계약, 유한성 검사 후 적용).
        ...(typeof distance === "number" && Number.isFinite(distance)
          ? { distanceMeters: Math.round(distance) }
          : {}),
        ...(pathCoords.length > 0 ? { pathCoords } : {}),
      });
    }
  }
  if (steps.length === 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 안내 단계 0개");
  }
  // 총 거리·시간도 동일 계약으로 정수 보장(iOS Int 디코딩 방어).
  return {
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    steps,
    ...(waypoint ? { waypoint } : {}),
  };
}

/** leg의 첫/끝 유한 좌표(guidance 유무와 무관 — 경유점 스텝도 경계가 된다). */
function legEdgeCoord(
  leg: { steps?: KakaoWalkStep[] } | undefined,
  edge: "first" | "last",
): Coord | undefined {
  const steps = leg?.steps ?? [];
  const ordered = edge === "last" ? [...steps].reverse() : steps;
  for (const step of ordered) {
    const points = (step.path?.points ?? []).filter(
      ([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng),
    );
    const pt = edge === "last" ? points[points.length - 1] : points[0];
    if (pt) return { lat: pt[1], lng: pt[0] };
  }
  return undefined;
}

/**
 * 카카오 도보 경로 조회. 경로 없으면 null(graceful), HTTP 실패·미관측 status·
 * 스키마 위반은 throw(서비스가 Tmap 폴백으로 전환). 타임아웃 8초: 무한 대기는
 * throw가 아니라서 폴백이 영영 발동하지 않는다(spec §아키텍처).
 */
export async function getKakaoWalkBriefing(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
  /** 경유지 1개(N4). */
  via?: Coord;
  /**
   * 실시간 길 안내(기하 포함) 요청은 서버 캐시를 우회한다(스펙 2026-08-03 §7.2):
   * 세션 전용 실시간 데이터를 revalidate에 태우면 "세션 한정 메모리 보유, 저장 아님"
   * 약관 판단과 모순된다. 비기하 요청의 기존 캐시 계약은 불변.
   */
  noStore?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible, via, noStore } = params;
  const url = new URL(ENDPOINT);
  // 계단 회피는 정확도가 안전과 직결하므로 원좌표 그대로(위 헤더 주석).
  const c = (v: number) => (accessible ? String(v) : roundCoord(v, 4));
  url.searchParams.set("start_x", c(origin.lng));
  url.searchParams.set("start_y", c(origin.lat));
  url.searchParams.set("end_x", c(dest.lng));
  url.searchParams.set("end_y", c(dest.lat));
  if (accessible) url.searchParams.set("route_mode", "ACCESSIBLE");
  if (via) {
    url.searchParams.set("via_x", c(via.lng));
    url.searchParams.set("via_y", c(via.lat));
  }
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}` },
    signal: AbortSignal.timeout(8_000),
    // route_mode가 URL에 포함되어 모드별 캐시가 자연 분리된다(spec §캐시).
    ...(noStore ? { cache: "no-store" as const } : { next: { revalidate: 3600 } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 도보 경로 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return normalizeKakaoWalkRoute((await res.json()) as KakaoWalkResponse, {
    expectWaypoint: via !== undefined,
    via,
  });
}
