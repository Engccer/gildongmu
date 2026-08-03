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
    /** S=출발(첫 안내 문장 보유 — 스텝), E=도착(마커), N=일반 안내(실측 2026-08-03). */
    pointType?: string;
    totalDistance?: number;
    totalTime?: number;
    totalFare?: number;
    taxiFare?: number;
    [key: string]: unknown;
  };
}

/** LineString feature(구간 폴리라인) — B1 실시간 자동차 안내의 기하 원천. */
interface TmapCarLineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    name?: string;
    distance?: number;
    [key: string]: unknown;
  };
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
export function normalizeTmapCarRoute(
  data: TmapCarResponse,
  opts: { includeGeometry?: boolean } = {},
): CarRouteBriefing {
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
  let terminal: Coord | undefined;
  if (!opts.includeGeometry) {
    // 기존 브리핑 경로 그대로(byte-호환 계약 — 스키마 스냅숏이 강제).
    for (const point of points) {
      const description = point.properties.description;
      if (!description) continue;
      guides.push({ name: "", guidance: description, distanceMeters: 0, durationSeconds: 0 });
    }
  } else {
    // 기하 옵트인(B1 §5): 스텝 = description 있는 Point 중 **종점(E) 제외**.
    // 출발(S)은 실제 첫 안내 문장을 갖는 스텝이고(실측 2026-08-03: "올림픽로를
    // 따라 12m 이동"), E("도착")는 뒤따르는 LineString이 없어 스텝화하면 0-길이
    // 스텝이 buildGuideRoute를 null로 만들어 상세 전체가 조용히 강등된다(조사 §2).
    // 각 스텝의 기하 = 그 Point 좌표 + 다음 Point 전까지의 LineString 병합
    // ("동작 + 이후 구간" 기준점 계약, §4.7). guide 수치 하드코딩 0은 유지 —
    // description에 거리가 내장돼 수치 병기는 중복 낭독이다.
    let current: CarRouteGuide | null = null;
    let coords: Coord[] = [];
    let links: NonNullable<CarRouteGuide["roadLinks"]> = [];
    const flush = () => {
      if (!current) return;
      current.pathCoords = coords;
      current.roadLinks = links;
      guides.push(current);
      current = null;
      coords = [];
      links = [];
    };
    for (const f of data.features) {
      if (isPointFeature(f)) {
        flush();
        const description = f.properties.description;
        if (!description || f.properties.pointType === "E") {
          // 종점 마커 좌표는 보존한다 — 마지막 스텝 끝과의 일치가 전 구간 커버리지
          // 검증 축이다(§5, 독립 리뷰: 버리면 짧은 조립이 fail-closed를 우회한다).
          if (f.properties.pointType === "E") {
            const [lng, lat] = f.geometry.coordinates;
            terminal = { lat, lng };
          }
          continue;
        }
        current = { name: "", guidance: description, distanceMeters: 0, durationSeconds: 0 };
        const [lng, lat] = f.geometry.coordinates;
        coords = [{ lat, lng }];
      } else if (current) {
        for (const [lng, lat] of f.geometry.coordinates) {
          const prev = coords[coords.length - 1];
          if (!prev || prev.lat !== lat || prev.lng !== lng) coords.push({ lat, lng });
        }
        // "일반도로"(roadType 6 무명 계열)는 도로명이 아니라 자리표시자 — null로
        // 낮춰 가짜 정밀을 만들지 않는다(§4.7).
        const rawName = typeof f.properties.name === "string" ? f.properties.name : "";
        links.push({
          name: rawName && rawName !== "일반도로" ? rawName : null,
          distanceMeters:
            typeof f.properties.distance === "number" ? f.properties.distance : 0,
        });
      }
    }
    flush();
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
    // 기하 옵트인에서만 종점 마커 노출(미지정 응답 byte-호환 유지).
    ...(terminal !== undefined ? { terminalCoord: terminal } : {}),
  };
}

/** 자동차 경로 텍스트 브리핑 조회. 실패는 전부 throw(폴백 판단은 car-route.ts 몫). */
export async function getTmapCarBriefing(params: {
  origin: Coord;
  dest: Coord;
  includeGeometry?: boolean;
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
  return normalizeTmapCarRoute(data, { includeGeometry: params.includeGeometry });
}
