import { env } from "../env";
import type { CarRouteBriefing, CarRouteGuide, Coord } from "../types";

/**
 * Tmap(SK Open API) 자동차 경로 provider — ko 기본(2026-07-30 실호출 대조·위원장 판정).
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/tmap/routes?version=1
 * 인증: 헤더 appKey(도보 폴백과 동일한 SK Open API 앱 "gildongmu" 단일 키).
 *
 * 낭독 정본은 Point feature의 properties.description — 도로명·거리가 내장된
 * 완성 문장("교차로에서 우회전 후 명일로를 따라 244m 이동")이라 그대로 쓴다
 * (turnType 재조합 금지, tmap-pedestrian 동형). 따라서 guide별
 * distanceMeters/durationSeconds는 0(미제공 의미론) — 소비자는 >0일 때만
 * 수치를 병기하므로 카카오 폴백(실수치)과 중복 없이 공존한다.
 *
 * 캐시 금지(no-store): 실시간 교통 반영 응답(kakao-navi 관례 동형.
 * POST는 Next fetch revalidate가 실효이기도 하다).
 * "경로 없음"류 오류 코드는 실제 관측 시에만 graceful 분기를 추가한다
 * (추측 금지) — 현재는 전부 throw라 서비스 계층이 카카오로 폴백한다.
 */

const ENDPOINT = "https://apis.openapi.sk.com/tmap/routes?version=1";

/** Point feature(안내 지점). 첫 지점만 총계 4필드를 싣는다. */
interface TmapCarPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    description?: string;
    totalDistance?: number;
    totalTime?: number;
    totalFare?: number;
    taxiFare?: number;
    [key: string]: unknown;
  };
}

/** LineString feature(구간 폴리라인). 지도 없는 이 앱에선 쓰지 않는다. */
interface TmapCarLineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { [key: string]: unknown };
}

type TmapCarFeature = TmapCarPointFeature | TmapCarLineFeature;

/** Tmap 자동차 경로 원본 응답(GeoJSON FeatureCollection). */
export interface TmapCarResponse {
  type: "FeatureCollection";
  features: TmapCarFeature[];
}

function isPointFeature(f: TmapCarFeature): f is TmapCarPointFeature {
  return f.geometry.type === "Point";
}

/**
 * Tmap 응답 → CarRouteBriefing 정규화(순수 함수).
 * 총 거리·시간·택시요금이 깨져 있으면 throw(3-state — 깨진 경로를 확정
 * 낭독하지 않는다. throw는 서비스 계층에서 카카오 폴백으로 흡수).
 * totalFare(통행료) 부재만 0으로 투영한다(무통행 구간 관례).
 */
export function normalizeTmapCarRoute(data: TmapCarResponse): CarRouteBriefing {
  const points = data.features.filter(isPointFeature);
  const head = points.find((p) => p.properties.totalDistance != null);
  const distanceMeters = head?.properties.totalDistance ?? NaN;
  const durationSeconds = head?.properties.totalTime ?? NaN;
  const taxiFare = head?.properties.taxiFare ?? NaN;

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 총 거리 값 이상");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 총 시간 값 이상");
  }
  if (!Number.isFinite(taxiFare)) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 택시요금 값 이상");
  }

  const guides: CarRouteGuide[] = [];
  for (const point of points) {
    const description = point.properties.description;
    if (!description) continue;
    guides.push({ name: "", guidance: description, distanceMeters: 0, durationSeconds: 0 });
  }
  if (guides.length === 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 안내 단계 0개");
  }

  return {
    // iOS CarRouteBriefing이 엄격 Int 디코딩이라 전부 반올림
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    taxiFare: Math.round(taxiFare),
    tollFare: Math.round(head?.properties.totalFare ?? 0),
    guides,
  };
}

/** 자동차 경로 텍스트 브리핑 조회. 실패는 전부 throw(폴백 판단은 car-route.ts 몫). */
export async function getTmapCarBriefing(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  const { origin, dest } = params;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      appKey: env.TMAP_APP_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startX: String(origin.lng),
      startY: String(origin.lat),
      endX: String(dest.lng),
      endY: String(dest.lat),
      reqCoordType: "WGS84GEO",
      resCoordType: "WGS84GEO",
    }),
    // 실시간 교통이 반영되는 응답이라 캐시하지 않는다
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tmap 자동차 경로 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as TmapCarResponse;
  return normalizeTmapCarRoute(data);
}
