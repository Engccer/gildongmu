import { env } from "../env";
import { roundCoord } from "../coord-round";
import type { Coord, WalkRouteBriefing, WalkRouteStep } from "../types";

/**
 * Tmap(SK Open API) 보행자 경로안내 provider.
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1
 * 인증: 헤더 appKey (SK Open API 앱 "gildongmu", 보행자·자동차 경로 공용 단일 키,
 * 2026-07-21 실호출 검증: 길동 2.1km 구간 완성 문장 24단계 정상 수신).
 *
 * 응답은 GeoJSON FeatureCollection이며 Point(안내 지점)와 LineString(폴리라인
 * 좌표) feature가 섞여 있다. **낭독 정본은 Point feature의 properties.description**
 * (이미 완성된 한국어 안내문, 예 "158m 이동 후 우회전")이다. LineString은 지도
 * 없는 이 앱에선 쓰지 않는다(좌표를 받지도 않는다). turnType(코드)로 문장을
 * 재조합하지 않는다(서울버스 arrmsg1·카카오모빌리티 guidance 원칙과 동형).
 * description이 없는 Point는 경유 좌표점이라 안내 단계에서 제외한다.
 *
 * 주의: 좌표 파라미터는 startX/endX=경도(lng), startY/endY=위도(lat).
 * 이 파일 밖은 lat/lng 도메인. startName/endName은 응답 안내문에 실제로
 * 쓰이지 않음이 실호출로 확인되어 ASCII 상수 "start"/"end"로 고정한다.
 *
 * 캐시: revalidate 3600(보행 경로는 준정적이라 같은 좌표쌍 캐시로 일 1,000건
 * 무료 쿼터를 보호한다). 좌표는 4자리 반올림으로 캐시 키 안정화(측위마다
 * 키가 달라지는 것 방지).
 */

const ENDPOINT =
  "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";

/** Point feature(안내 지점). 첫 지점만 totalDistance/totalTime을 싣는다. */
interface TmapPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    description?: string;
    totalDistance?: number;
    totalTime?: number;
    [key: string]: unknown;
  };
}

/** LineString feature(구간 폴리라인). 좌표는 지도 없는 이 앱에서 쓰지 않는다. */
interface TmapLineStringFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    [key: string]: unknown;
  };
}

type TmapFeature = TmapPointFeature | TmapLineStringFeature;

/** Tmap 보행자 경로안내 원본 응답(GeoJSON FeatureCollection). */
export interface TmapRouteResponse {
  type: "FeatureCollection";
  features: TmapFeature[];
}

function isPointFeature(f: TmapFeature): f is TmapPointFeature {
  return f.geometry.type === "Point";
}

/** Tmap 오류 응답(비200) 형태. */
interface TmapErrorBody {
  error?: { id?: string; category?: string; code?: string; message?: string };
}

// "경로 없음"류로 graceful(null) 처리할 Tmap error.code.
// 3102: "해당 서비스가 지원되지 않는 구간입니다.([ZeroResults]...)", 도보 불가
// 구간(실호출 검증 2026-07-22, 서울↔제주). 다른 경로없음 코드는 실제 관측 시
// 추가한다(추측 금지). 그 외 코드(인증·파라미터·서버 오류)는 throw.
const NO_ROUTE_ERROR_CODES = new Set(["3102"]);

/**
 * Tmap 응답 → WalkRouteBriefing 정규화(순수 함수).
 *
 * Point feature의 description만 순서대로 step으로 추출하고(description 없는
 * 경유 좌표점은 제외), 첫 Point의 totalDistance/totalTime을 총 거리·시간으로
 * 투영한다. 총 거리/시간이 유한 양수가 아니거나 안내 단계가 0개면 깨진 경로를
 * 시각장애 사용자에게 확정 낭독하지 않도록 throw한다(3-state 원칙, "조회 실패"
 * 를 "정상 결과"로 뭉개지 않는다).
 */
export function normalizeTmapWalkRoute(
  data: TmapRouteResponse,
): WalkRouteBriefing {
  const points = data.features.filter(isPointFeature);
  const first = points[0];
  const distanceMeters = first?.properties.totalDistance ?? NaN;
  const durationSeconds = first?.properties.totalTime ?? NaN;

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("Tmap 보행자 경로 정규화 실패: 총 거리 값 이상");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Tmap 보행자 경로 정규화 실패: 총 시간 값 이상");
  }

  const steps: WalkRouteStep[] = [];
  for (const point of points) {
    const description = point.properties.description;
    if (description) steps.push({ description });
  }

  if (steps.length === 0) {
    throw new Error("Tmap 보행자 경로 정규화 실패: 안내 단계 0개");
  }

  return { distanceMeters, durationSeconds, steps };
}

/**
 * 도보 경로 텍스트 브리핑 조회. 경로 없으면 null(graceful), 그 외 HTTP
 * 실패/장애는 throw한다(라우트가 502로 전파). "경로 없음"류 응답 코드는
 * 실호출로 관측된 것만 graceful 처리로 보강한다(ODsay -98 패턴, 추측 금지).
 */
export async function getWalkRouteBriefing(params: {
  origin: Coord;
  dest: Coord;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest } = params;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      appKey: env.TMAP_APP_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startX: roundCoord(origin.lng, 4),
      startY: roundCoord(origin.lat, 4),
      endX: roundCoord(dest.lng, 4),
      endY: roundCoord(dest.lat, 4),
      reqCoordType: "WGS84GEO",
      resCoordType: "WGS84GEO",
      startName: "start",
      endName: "end",
    }),
    // 보행 경로는 준정적이라 같은 좌표쌍 캐시로 일 1,000건 무료 쿼터를 보호
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const code = (() => {
      try {
        return (JSON.parse(body) as TmapErrorBody).error?.code;
      } catch {
        return undefined;
      }
    })();
    if (code !== undefined && NO_ROUTE_ERROR_CODES.has(code)) return null;
    throw new Error(`Tmap 보행자 경로 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as TmapRouteResponse;
  return normalizeTmapWalkRoute(data);
}
