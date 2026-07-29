import { env } from "../env";
import { roundCoord } from "../coord-round";
import type { Coord, WalkRouteBriefing, WalkRouteStep } from "../types";

/**
 * 카카오 도보 경로안내 provider.
 *
 * 엔드포인트: GET https://dapi.kakao.com/v2/routing/walk
 * 인증: 헤더 Authorization: KakaoAK {REST 키}(카카오 로컬·모빌리티 공용 단일 키).
 *
 * 응답 envelope은 실호출 확정(2026-07-22·07-29): top-level `route`가 **단수
 * 객체**(배열 아님)이고 top-level `status` 문자열을 동반한다(data.go.kr류
 * response.body.items 포맷과 무관). `route.legs[].steps[]`의 `properties.guidance`
 * 가 **완성된 한국어 안내문**으로 낭독 정본이다(Tmap description·서울버스
 * arrmsg1과 동형 — turnType류 코드 재조합 금지). `path.points`는 스텝 폴리라인
 * [lng, lat] 배열이며, walk-route 서비스가 음향신호기 주석 판정의 후보점으로
 * 쓴 뒤 응답 전 제거한다(pathCoords는 API 응답 비노출).
 *
 * status: "OK" 성공, "TOO_FAR_AWAY"·"ROUTE_RESULT_NOT_FOUND" 2종만 경로 불가로
 * graceful null 처리(실호출 관측분만, 추측 금지) — 그 외 미관측 status는 장애를
 * 경로 없음으로 뭉개지 않도록 throw한다(fail-closed).
 *
 * accessible=true 시 route_mode=ACCESSIBLE(무장애 경로, 실호출 확인) 파라미터를
 * 추가한다. en 미지원(안내문이 한국어 고정) — V1 ko 전용은 Tmap과 동일 스코프.
 *
 * 캐시: revalidate 3600(보행 경로는 준정적). 좌표는 4자리 반올림으로 캐시 키
 * 안정화(`roundCoord`, route_mode가 URL에 포함되어 모드별 캐시가 자연 분리).
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
  for (const leg of route.legs ?? []) {
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
  };
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
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible } = params;
  const url = new URL(ENDPOINT);
  url.searchParams.set("start_x", String(roundCoord(origin.lng, 4)));
  url.searchParams.set("start_y", String(roundCoord(origin.lat, 4)));
  url.searchParams.set("end_x", String(roundCoord(dest.lng, 4)));
  url.searchParams.set("end_y", String(roundCoord(dest.lat, 4)));
  if (accessible) url.searchParams.set("route_mode", "ACCESSIBLE");
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}` },
    signal: AbortSignal.timeout(8_000),
    // route_mode가 URL에 포함되어 모드별 캐시가 자연 분리된다(spec §캐시).
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 도보 경로 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return normalizeKakaoWalkRoute((await res.json()) as KakaoWalkResponse);
}
