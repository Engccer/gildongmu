import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear } from "./providers/surroundings";
import { findStationsNear } from "./subway-stations";
import { bearingDegrees, bearingToCompass8 } from "./geo/bearing";
import type { SurroundingPlace, WhereAmI } from "./types";

/** 근접역 탐색 반경(m) — 이 밖이면 역 문장 생략. */
const STATION_RADIUS = 1000;

/**
 * 도로명에서 행정동과 겹치는 행정구역 접두(시·도 + 시·군·구)를 제거한다.
 * 행정동·도로명이 둘 다 풀 주소라 "서울특별시 강동구"가 두 번 낭독되는 것을 막아
 * "서울특별시 강동구 길동, 천중로44길 74"처럼 한 번만 읽히게 한다(시각장애 사용자
 * 중복 낭독 회피). region이 없거나 토큰이 2개 미만이거나 접두가 안 맞으면 원문 유지.
 */
export function stripRegionPrefix(region: string | null, road: string): string {
  if (!region) return road;
  const tokens = region.split(/\s+/);
  if (tokens.length < 2) return road;
  const prefix = tokens.slice(0, -1).join(" "); // 동/읍/면 제외한 시·도+시·군·구
  return road.startsWith(prefix + " ") ? road.slice(prefix.length + 1) : road;
}


/**
 * I/O: 좌표 → 네 조각 병렬 조립. 각 조각 독립 실패(allSettled) — 한 조각 실패가
 * 나머지를 죽이지 않는다. 근접역은 정적 seed(거의 항상 성공)지만 1km 밖이면 null.
 * 전부 비는 경우의 502 판정은 라우트가 한다(여기선 비어도 정상 반환).
 */
export async function assembleWhereAmI(
  lat: number,
  lng: number,
): Promise<WhereAmI> {
  const [addrR, regionR, surroundingsR] = await Promise.allSettled([
    coordToAddress({ lat, lng }),
    coordToRegion({ lat, lng }),
    findSurroundingsNear(lat, lng),
  ]);

  const addr = addrR.status === "fulfilled" ? addrR.value : null;
  const address =
    addr && (addr.roadAddress || addr.jibunAddress)
      ? { road: addr.roadAddress, jibun: addr.jibunAddress }
      : null;

  const region = regionR.status === "fulfilled" ? regionR.value : null;

  const landmarks: SurroundingPlace[] =
    surroundingsR.status === "fulfilled" ? surroundingsR.value : [];

  // 근접역: seed 동기 호출(예외 없음). 1km 내 최근접 1역.
  const near = findStationsNear(lat, lng, {
    radiusMeters: STATION_RADIUS,
    dedupeByName: true,
    limit: 1,
  });
  const st = near[0];
  const nearestStation = st
    ? {
        name: st.name,
        line: st.lineName || undefined,
        bearing: bearingToCompass8(bearingDegrees(lat, lng, st.lat, st.lng)),
        distanceMeters: Math.round(st.distanceMeters),
      }
    : null;

  return { address, region, nearestStation, landmarks };
}
