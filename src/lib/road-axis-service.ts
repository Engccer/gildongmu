import { unstable_cache } from "next/cache";
import { searchJusoAddresses } from "./providers/juso-address";
import { searchAddress } from "./providers/kakao-address";
import { parseRoadAddress } from "./road-address";
import { fitRoadAxis, type AxisSample, type RoadAxis } from "./geo/road-axis";
import type { Coord } from "./types";

/** 축 표본 상한. 도로 하나에 지오코딩을 무한정 돌리지 않는다. */
const MAX_SAMPLES = 12;

/**
 * 도로 진행축을 juso 건물 목록으로 복원한다.
 *
 * ⚠ **표본을 POI로 잡지 않는다.** 카테고리 세트·반경이 조금만 달라져도 축이
 * 미세하게 회전해, 임계 근처 장소가 조회할 때마다 다른 묶음으로 간다(실측).
 * juso는 같은 도로에 대해 항상 같은 건물 집합을 주므로 결정론적이다. 골목처럼
 * POI가 적은 곳도 건물은 있어서 살아난다(명일로24길: POI 3건 vs 건물 5건).
 *
 * 실패는 전부 null이다. 축이 없으면 상위 계층이 절대 방위로 물러난다(3-state).
 * (테스트는 이 함수를 직접 부른다 — `resolveRoadAxis`는 캐시 래퍼일 뿐이다.)
 */
export async function fetchRoadAxis(
  region: string,
  road: string,
  origin: Coord,
): Promise<RoadAxis | null> {
  let rows: { roadAddrPart1: string }[];
  try {
    rows = await searchJusoAddresses(`${region} ${road}`, 1, 100);
  } catch {
    return null;
  }
  // 본번만 남기고 중복 제거 — 부번은 같은 기초번호라 축 추정을 흐린다.
  const byMain = new Map<number, string>();
  for (const r of rows) {
    const parsed = parseRoadAddress(r.roadAddrPart1);
    if (!parsed || parsed.road !== road || parsed.sub !== null) continue;
    if (!byMain.has(parsed.main)) byMain.set(parsed.main, r.roadAddrPart1);
  }
  if (byMain.size < 3) return null;

  const picked = [...byMain.entries()].slice(0, MAX_SAMPLES);
  const samples: AxisSample[] = [];
  for (const [main, addr] of picked) {
    try {
      const match = (await searchAddress(addr, 1))[0];
      if (match) samples.push({ main, lat: match.lat, lng: match.lng });
    } catch {
      // 개별 실패는 표본 하나를 잃을 뿐이다.
    }
  }
  return fitRoadAxis(origin, samples);
}

/**
 * 도로 축은 변하지 않으므로 도로 단위로 캐시한다. 요청형 기능이라 첫 조회의
 * 왕복 지연은 허용된다(자동 발화 경로가 아니다).
 */
export function resolveRoadAxis(
  region: string,
  road: string,
  origin: Coord,
): Promise<RoadAxis | null> {
  return unstable_cache(
    () => fetchRoadAxis(region, road, origin),
    ["road-axis", region, road],
    { revalidate: 86_400 },
  )();
}
