import {
  coordToAddress,
  coordToRegion,
  coordToRegionNames,
} from "./providers/kakao-address";
import { findSurroundingsNear, ALL_CATEGORY_GROUPS } from "./providers/surroundings";
import { resolveRoadAxis } from "./road-axis-service";
import { parseRoadAddress, isOddSide } from "./road-address";
import {
  classifyBucket,
  entranceFrame,
  type SurroundingBucket,
} from "./geo/road-axis";
import {
  bearingDegrees,
  bearingToCompass8,
  type CompassDirection,
} from "./geo/bearing";
import type { SurroundingPlace } from "./types";

/**
 * M1 도착지 부근 상황 재구성 — 앵커 좌표 하나를 받아 "입구를 마주 본" 기준의
 * 왼쪽·오른쪽·맞은편·건물 너머 묶음으로 주변을 조립한다.
 *
 * 설계 정본 `docs/superpowers/specs/2026-08-09-arrival-surroundings-design.md`.
 * 앵커가 장소 좌표면 역지오코딩이 도로명+건물번호를 주고(실측 9/10) 축이 서며,
 * 보도 GPS면 대부분 실패해(실측 7.2%) 방위 폴백으로 물러난다 — 위치 출처 분기가
 * 코드 없이 데이터로 성립한다(spec §5).
 */

/** spec §8: "한눈에 보이는" 범위. 넓히면 "옆에 있다"는 진술이 약해진다. */
const RADIUS_M = 150;

/**
 * 후보 상한. 둘러보기 SERVER_CAP(50)을 물려받으면 밀집 상권에서 **분류 전에**
 * 상류가 잘라 "건물 너머" 같은 큰 묶음이 조용히 축소된다(spec 판정 9 "다 말한다"
 * 위반). 이론상 최대 18종×15건=270이지만 150m 반경에선 이 값이면 실질 무절단.
 */
const SCENE_CAP = 150;

export interface SceneItem {
  name: string;
  distanceMeters: number;
  /** 앵커와 다른 도로일 때만 채운다(같으면 잉여). */
  road: string | null;
  category: string;
  // ── 장소 상세 진입 재료(M4 판정 ⑤, 2026-08-22). 소비자가 `Place`로 투영한다
  // (Kit `sceneItemToPlace` ↔ 웹 `surroundingPlaceToPlace` 동형). 실재성 헤지는
  // 출처 각주가 그대로 맡는다 — 상세로 여는 것과 이름을 단정하는 것은 다른 층이다.
  id: string;
  lat: number;
  lng: number;
  /** 카카오 category_name 전체 계층(상세의 역 판별 등에 필요). */
  categoryRaw: string;
  roadAddress: string | null;
  phone?: string;
  link?: string;
}

export interface SceneGroup {
  bucket: SurroundingBucket | CompassDirection;
  items: SceneItem[];
}

export interface Scene {
  /** 위치 확인 문장 재료(행정동 + 도로명주소). 못 얻으면 null. */
  place: string | null;
  /** entrance = 입구 기준 좌우, compass = 절대 방위 폴백(3-state) */
  frame: "entrance" | "compass";
  groups: SceneGroup[];
  total: number;
}

const BUCKET_ORDER: SurroundingBucket[] = ["left", "right", "across", "beyond"];

export async function assembleScene(lat: number, lng: number): Promise<Scene> {
  const [addr, region, regionNames, places] = await Promise.all([
    coordToAddress({ lat, lng }).catch(() => null),
    coordToRegion({ lat, lng }).catch(() => null),
    // juso 키워드용 시도·시군구는 표시 문자열 공백 분할이 아니라 조각으로 받는다
    // — 토큰 수가 지역마다 달라 조용히 어긋난다(kakao-address.ts 경고 주석 정본).
    coordToRegionNames({ lat, lng }),
    findSurroundingsNear(lat, lng, {
      groups: ALL_CATEGORY_GROUPS,
      radiusMeters: RADIUS_M,
      cap: SCENE_CAP,
    }),
  ]);

  const roadAddress = addr?.roadAddress ?? null;
  const place =
    [region, roadAddress ?? addr?.jibunAddress].filter(Boolean).join(", ") || null;
  const anchor = roadAddress ? parseRoadAddress(roadAddress) : null;

  // 세종은 city가 빈 문자열 — 시도만으로 juso 키워드가 성립한다.
  const jusoRegion = regionNames
    ? [regionNames.province, regionNames.city].filter(Boolean).join(" ")
    : null;
  const axis =
    anchor && jusoRegion
      ? await resolveRoadAxis(jusoRegion, anchor.road, { lat, lng })
      : null;

  const toItem = (p: SurroundingPlace): SceneItem => {
    const parsed = p.roadAddress ? parseRoadAddress(p.roadAddress) : null;
    return {
      name: p.name,
      distanceMeters: Math.round(p.distanceMeters),
      road: parsed && parsed.road !== anchor?.road ? parsed.road : null,
      category: p.category,
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      categoryRaw: p.categoryRaw,
      roadAddress: p.roadAddress,
      phone: p.phone,
      link: p.link,
    };
  };

  const grouped = new Map<string, SceneItem[]>();

  if (axis && anchor) {
    const frame = entranceFrame(axis, isOddSide(anchor));
    for (const p of places) {
      const parsed = p.roadAddress ? parseRoadAddress(p.roadAddress) : null;
      // 맞은편 판정은 같은 도로 + 본번(부번 없음) + 홀짝 반대일 때만(spec §3.3).
      const acrossByParity =
        !!parsed &&
        parsed.road === anchor.road &&
        parsed.sub === null &&
        anchor.sub === null &&
        parsed.main % 2 !== anchor.main % 2;
      const bucket = classifyBucket(
        frame,
        { lat, lng },
        { lat: p.lat, lng: p.lng },
        { acrossByParity },
      );
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), toItem(p)]);
    }
    const groups = BUCKET_ORDER.filter((b) => grouped.has(b)).map((b) => ({
      bucket: b as SurroundingBucket,
      items: grouped.get(b)!.sort((a, c) => a.distanceMeters - c.distanceMeters),
    }));
    return { place, frame: "entrance", groups, total: places.length };
  }

  // 폴백: 축을 못 세웠다. 침묵하지 않고 절대 방위로 물러난다(3-state).
  for (const p of places) {
    const dir = bearingToCompass8(bearingDegrees(lat, lng, p.lat, p.lng));
    grouped.set(dir, [...(grouped.get(dir) ?? []), toItem(p)]);
  }
  const groups = [...grouped.entries()]
    .map(([bucket, items]) => ({
      bucket: bucket as CompassDirection,
      items: items.sort((a, c) => a.distanceMeters - c.distanceMeters),
    }))
    .sort(
      (a, b) => (a.items[0]?.distanceMeters ?? 0) - (b.items[0]?.distanceMeters ?? 0),
    );
  return { place, frame: "compass", groups, total: places.length };
}
