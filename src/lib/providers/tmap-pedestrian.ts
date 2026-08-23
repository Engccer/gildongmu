import { env } from "../env";
import { roundCoord } from "../coord-round";
import { pedestrianStepFor } from "../pedestrian-action";
import { assertDistanceMatchesKorean, assertTurnTypeMatchesKorean } from "../pedestrian-guard";
import type { Coord, RouteWaypoint, WalkRouteBriefing, WalkRouteStep } from "../types";

/**
 * Tmap(SK Open API) 보행자 경로안내 provider.
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1
 * 인증: 헤더 appKey (SK Open API 앱 "gildongmu", 보행자·자동차 경로 공용 단일 키,
 * 2026-07-21 실호출 검증: 길동 2.1km 구간 완성 문장 24단계 정상 수신).
 *
 * 응답은 GeoJSON FeatureCollection이며 Point(안내 지점)와 LineString(폴리라인
 * 좌표) feature가 섞여 있다. **낭독 정본은 Point feature의 properties.description**
 * (이미 완성된 한국어 안내문, 예 "158m 이동 후 우회전")이다. turnType(코드)로
 * 문장을 재조합하지 않는다(서울버스 arrmsg1·카카오모빌리티 guidance 원칙과 동형).
 * description이 없는 Point는 경유 좌표점이라 안내 단계에서 제외한다.
 *
 * LineString은 기본적으로 버리되, includeLineGeometry 옵션이면 직전 안내
 * 스텝의 pathCoords로 귀속한다(실시간 안내의 이탈 판정이 실경로 곡률을
 * 따라가는 성립 조건 — 안내 지점 사이 직선 보간은 곡률에서 헛경고를 낸다).
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
    /** SP=출발, GP=안내, PP1=경유지(passList 1번째), EP=도착(실호출 2026-08-22). */
    pointType?: string;
    /** 회전 유형 코드 — `pedestrianStepFor`로 행동·영어 문구를 낸다(E16 축3). */
    turnType?: number;
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
    /** 구간 길이(m). 문장이 말하는 거리는 스텝의 **첫** 구간 값이다. */
    distance?: number;
    /** 도로명(ko). 빈 문자열이면 이름 없는 보행로 — 문장에도 도로 절이 없다. */
    name?: string;
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
 *
 * includeLineGeometry면 features 순회 중 만나는 LineString 좌표를 직전 안내
 * 스텝의 pathCoords에 이어붙인다(접점 중복 1개 제거). description 없는 경유
 * Point는 스텝을 만들지 않지만 귀속 대상 포인터를 끊지도 않는다 — 경유점
 * 앞뒤의 LineString이 모두 같은 안내 스텝의 구간이기 때문이다.
 */
export function normalizeTmapWalkRoute(
  data: TmapRouteResponse,
  opts?: {
    includeLineGeometry?: boolean;
    /** passList를 보냈다 — PP1 Point가 없으면 파라미터가 무시된 것이라 throw(N4). */
    expectWaypoint?: boolean;
    /**
     * 한국어 원문 대조 가드를 켠다(E16 축3, en 전용). ko 폴백 경로는 기본 false로 종전 동작을
     * 유지한다 — 가드는 en 문장이 구조화 필드에서 나올 때만 필요하고, 새 실패 모드를 ko에
     * 들이지 않는다.
     */
    guard?: boolean;
  },
): WalkRouteBriefing {
  const includeLineGeometry = opts?.includeLineGeometry === true;
  let waypoint: RouteWaypoint | undefined;
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
  // 직후 LineString을 귀속할 스텝(마지막으로 push된 안내 스텝).
  let attachTarget: WalkRouteStep | undefined;
  for (const feature of data.features) {
    if (isPointFeature(feature)) {
      const description = feature.properties.description;
      if (!description) continue; // 경유점 — attachTarget은 유지
      // geometry.coordinates는 [lng, lat] 순서. 좌표가 깨진 Point는 주석 판정만
      // 포기하고 안내문은 살린다(coord 생략 — walk-route 서비스가 무주석 처리).
      const [lng, lat] = feature.geometry.coordinates;
      const step: WalkRouteStep =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? { description, coord: { lat, lng } }
          : { description };
      if (opts?.expectWaypoint && feature.properties.pointType === "PP1" && !waypoint && step.coord) {
        waypoint = { stepIndex: steps.length, coord: step.coord };
      }
      // 구조화 투영(E16 축3): 행동 코드는 여기서 한 번만 분류한다(`pedestrian-action` 표 하나).
      const turnType = feature.properties.turnType;
      if (typeof turnType === "number") {
        const entry = pedestrianStepFor(turnType);
        if (opts?.guard) {
          if (!entry) {
            throw new Error(`[tmap-pedestrian] 미지 turnType ${turnType}: ${description}`);
          }
          assertTurnTypeMatchesKorean(turnType, description);
        }
        step.turnType = turnType;
        if (entry?.action) step.action = entry.action;
      }
      steps.push(step);
      attachTarget = step;
    } else if (attachTarget) {
      // ⚠ 문장의 거리·도로명은 **첫 LineString**이지 합이 아니다(30경로 435스텝 실측).
      // 한 Point 뒤에 짧은 연결 구간이 더 붙는 경우가 흔한데, 문장은 첫 구간만 말한다
      // ("…봉은사로를 따라 306m 이동" + 논현로 8m → 306). 합으로 읽으면 48/435가 어긋난다.
      // pathCoords는 아래에서 종전대로 **전부** 귀속한다 — 기하는 실경로를 따라야 한다.
      if (attachTarget.distanceMeters === undefined) {
        const d = feature.properties.distance;
        if (typeof d === "number" && Number.isFinite(d)) attachTarget.distanceMeters = d;
        const name = feature.properties.name;
        if (name) attachTarget.roadNameKo = name;
        if (opts?.guard) {
          assertDistanceMatchesKorean(attachTarget.description, attachTarget.distanceMeters);
        }
      }
      if (includeLineGeometry) {
        for (const [lng, lat] of feature.geometry.coordinates) {
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const acc = (attachTarget.pathCoords ??= []);
          const prev = acc[acc.length - 1];
          if (prev && prev.lat === lat && prev.lng === lng) continue; // 접점 중복 제거
          acc.push({ lat, lng });
        }
      }
    }
  }

  // 기하 모드: 기하 없는 후행 스텝(Tmap 종점 "도착" 마커 — 후속 LineString이
  // 없어 0길이 단일점)을 떨군다. 그대로 두면 buildGuideRoute의 유령 스텝
  // 가드가 경로 전체를 거부해 상세 안내가 조용히 간략으로 강등된다(실호출
  // 게이트 검출 2026-08-12). 카카오는 도착 스텝 자체를 내지 않으므로 떨군
  // 모양이 기존 소비자 계약과 정합. 비기하 브리핑은 현행 그대로("도착" 유지).
  if (includeLineGeometry) {
    while (steps.length > 1 && !steps[steps.length - 1].pathCoords) {
      steps.pop();
    }
  }

  if (steps.length === 0) {
    throw new Error("Tmap 보행자 경로 정규화 실패: 안내 단계 0개");
  }
  if (opts?.expectWaypoint && !waypoint) {
    throw new Error("Tmap 보행자 경로 실패: 경유지 요청인데 PP1 지점 없음(파라미터 무시 의심)");
  }
  // 기하 모드의 후행 pop이 PP1 스텝까지 떨굴 수 있다(경유지→도착 구간에 LineString이
  // 없는 경우). 인덱스만 남기면 소비자 가드가 구획 문장을 조용히 지우므로 throw(품질 리뷰).
  if (waypoint && waypoint.stepIndex >= steps.length) {
    throw new Error("Tmap 보행자 경로 실패: 경유지 스텝이 기하 없이 떨어져 나감");
  }

  return { distanceMeters, durationSeconds, steps, ...(waypoint ? { waypoint } : {}) };
}

/**
 * 도보 경로 텍스트 브리핑 조회. 경로 없으면 null(graceful), 그 외 HTTP
 * 실패/장애는 throw한다(라우트가 502로 전파). "경로 없음"류 응답 코드는
 * 실호출로 관측된 것만 graceful 처리로 보강한다(ODsay -98 패턴, 추측 금지).
 */
export async function getWalkRouteBriefing(params: {
  origin: Coord;
  dest: Coord;
  /** Tmap 탐색 옵션. "10"=최단. 미지정이면 미전송(폴백 경로 동작 불변). */
  searchOption?: "10";
  /** 경유지 1개(N4) — passList "lng,lat". */
  via?: Coord;
  /** LineString 좌표를 스텝 pathCoords로 보존(실시간 안내용). */
  includeLineGeometry?: boolean;
  /** 안내 중 전환·제안 재조회처럼 현시점 조회가 필요한 소비자용(kakao-walk 관례 동형). */
  noStore?: boolean;
  /** 한국어 원문 대조 가드(en 전용). */
  guard?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, searchOption, via, includeLineGeometry, noStore, guard } = params;
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
      ...(searchOption ? { searchOption } : {}),
      ...(via ? { passList: `${roundCoord(via.lng, 4)},${roundCoord(via.lat, 4)}` } : {}),
    }),
    // 보행 경로는 준정적이라 같은 좌표쌍 캐시로 일 1,000건 무료 쿼터를 보호
    // (단 POST fetch의 revalidate는 실효가 없어 사실상 비캐시 — 쿼터 방어의
    // 실질은 옵트인 축소다. noStore는 의도를 명시하는 계약 표기).
    ...(noStore ? { cache: "no-store" as const } : { next: { revalidate: 3600 } }),
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
  return normalizeTmapWalkRoute(data, {
    includeLineGeometry,
    expectWaypoint: via !== undefined,
    guard,
  });
}
