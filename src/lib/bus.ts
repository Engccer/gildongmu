import type { BusStop } from "./types";
import { fetchTagoNearby } from "./providers/tago-bus";
import { fetchSeoulNearby } from "./providers/seoul-bus";
import { coordToRegionNames } from "./providers/kakao-address";
import { judgeTagoCityCoverage } from "./tago-coverage";
import { hasKakaoKey } from "./env";
import { romanNameOf } from "./romanize";

/** 좌표 4자리(약 11m) 중복 판정 키 — en 장소병합과 동일 기준. */
function coordKey(s: BusStop): string {
  return `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
}

/**
 * TAGO + 서울 정류소를 병합한다. 좌표 4자리가 같으면 같은 정류소로 보고
 * 거리가 더 가까운 쪽만 남긴다(경계의 동일 정류소 중복 방지). 거리순 정렬 후 상위 5.
 */
export function mergeBusStops(tago: BusStop[], seoul: BusStop[]): BusStop[] {
  const byKey = new Map<string, BusStop>();
  for (const s of [...tago, ...seoul]) {
    const k = coordKey(s);
    const prev = byKey.get(k);
    if (!prev || s.distanceMeters < prev.distanceMeters) byKey.set(k, s);
  }
  return [...byKey.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5)
    // 정류소명 로마자(E28) — TAGO·TOPIS 공통 한 곳. ODsay 조인부(E27)와 무관.
    .map((s) => {
      const nameRoman = romanNameOf(s.name);
      return nameRoman ? { ...s, nameRoman } : s;
    });
}

/**
 * 좌표 근접 정류소 — TAGO·서울 병렬 병합 진입점.
 * 둘 다 실패해야 throw, 하나라도 성공이면 그 실데이터를 보존(가짜 폴백 금지).
 * 서울은 TAGO 미수록(서울 TOPIS 별도 운영)이라 강동·서울 경계에서 둘이 함께 잡힌다.
 */
export async function fetchNearbyBusStops(lat: number, lng: number): Promise<BusStop[]> {
  const [tagoR, seoulR] = await Promise.allSettled([
    fetchTagoNearby(lat, lng),
    fetchSeoulNearby(lat, lng),
  ]);
  if (tagoR.status === "rejected" && seoulR.status === "rejected") {
    throw new Error(`버스 정보 조회 실패: tago=${tagoR.reason}; seoul=${seoulR.reason}`);
  }
  const tago = tagoR.status === "fulfilled" ? tagoR.value : [];
  const seoul = seoulR.status === "fulfilled" ? seoulR.value : [];
  return mergeBusStops(tago, seoul);
}

/**
 * 0건이 "이 지역엔 정류소 데이터가 아예 없다"인지 판정한다(스펙
 * `2026-08-02-bus-uncovered-region-design.md` §4). 라우트·채팅 공용 진입점이므로
 * provider를 직접 부르지 말 것(두 소비자가 다른 규칙을 갖게 된다).
 *
 * ⚠ **정류소가 0건일 때만 부른다.** 좌표만 보고 미리 판정하면 담양·화순처럼 자기
 * 도시코드가 없어도 인접 광역시 버스가 넘어오는 지역에 거짓 "미제공"이 나간다(실측
 * 10건·23건). 그래서 이 마커만 다른 도메인과 달리 upstream **뒤**에 온다.
 *
 * ⚠ 0건의 대부분은 미커버가 아니라 TAGO 근접 조회의 ~700m 반경 밖이다. 판정이 서지
 * 않으면(키 없음·조회 실패·모르는 시도) **false로 되돌아가 현행 "근처에 없음"을 유지**한다.
 * 거짓 "미제공"이 거짓 "없음"보다 나쁘다: 전자는 다시 볼 여지까지 없앤다.
 */
export async function isUncoveredBusRegion(lat: number, lng: number): Promise<boolean> {
  if (!hasKakaoKey()) return false;
  try {
    const region = await coordToRegionNames({ lat, lng });
    if (!region) return false;
    return judgeTagoCityCoverage(region.province, region.city) === "uncovered";
  } catch (e) {
    console.error("[bus] 지역 판정 실패", e);
    return false;
  }
}
