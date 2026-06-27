import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear } from "./providers/surroundings";
import { findStationsNear } from "./subway-stations";
import { bearingDegrees, bearingToCompass8 } from "./geo/bearing";
import type { LocationNarrative, SurroundingPlace, WhereAmI } from "./types";

/** 산문 단락2에 노출할 기준점 최대 개수. */
const LANDMARK_CAP = 6;
/** 근접역 탐색 반경(m) — 이 밖이면 역 문장 생략. */
const STATION_RADIUS = 1000;

/**
 * 순수: WhereAmI → 산문 렌더용 구조화 데이터.
 * place는 행정동 + 도로명(없으면 지번)을 ", "로 합친 위치 문자열, 둘 다 없으면 null.
 * landmarks는 거리순 상위 LANDMARK_CAP. 입력을 변형하지 않는다.
 */
export function buildLocationNarrative(data: WhereAmI): LocationNarrative {
  const road = data.address?.road || data.address?.jibun || null;
  const parts = [data.region, road].filter((s): s is string => Boolean(s));
  const place = parts.length > 0 ? parts.join(", ") : null;
  return {
    place,
    station: data.nearestStation,
    landmarks: data.landmarks.slice(0, LANDMARK_CAP),
  };
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
