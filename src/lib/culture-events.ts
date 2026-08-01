import { haversineMeters } from "./geo";
import { loadRunningEvents } from "./providers/seoul-culture-events";
import type { CultureEvent } from "./types";

/**
 * 근처 문화행사 진입점 — 라우트·채팅 도구 공용.
 *
 * provider는 좌표와 무관한 "오늘 진행 중" 목록(캐시 대상)을 주고, 거리·반경·
 * 정렬·절단은 여기서 한다. "내 주변 거리순 정렬은 코드 책임" 규칙 그대로다.
 */

/**
 * 반경 3km. 5지점 실측 밀도가 지점마다 30배 넘게 갈려(1km 기준 시청 31건 vs
 * 길동 0건) 도보권(1~2km)으로 잡으면 주택가에선 기능이 없는 것과 같다. 3km면
 * 길동 5·강남 9·노원 13·홍대 20·시청 84로 전 지점에서 성립하고, 무장애
 * 관광지(3km)와 같은 "찾아갈 만한 목적지" 축이다.
 */
const RADIUS_METERS = 3000;

/** 서버 캡 — 장소 목록 4종 공통. 표시 절단은 클라 "더 보기" 몫. */
const SERVER_CAP = 50;

export interface NearbyEventsResult {
  /** 거리 오름차순, 최대 SERVER_CAP */
  events: CultureEvent[];
  /** 반경 내 전체 수(서버 캡·limit 절단 **전**) — 침묵 절단 금지 */
  total: number;
}

/** 좌표 → 반경 내 오늘 진행 중 문화행사(거리순). 키 없으면 빈 결과. */
export async function findEventsNear(
  lat: number,
  lng: number,
  opts: { nowMs?: number; radiusMeters?: number } = {},
): Promise<NearbyEventsResult> {
  const radius = opts.radiusMeters ?? RADIUS_METERS;
  const base = await loadRunningEvents(opts.nowMs ?? Date.now());
  const inRadius: CultureEvent[] = [];
  for (const e of base) {
    const distanceMeters = Math.round(haversineMeters(lat, lng, e.lat, e.lng));
    if (distanceMeters <= radius) inRadius.push({ ...e, distanceMeters });
  }
  inRadius.sort((a, b) => a.distanceMeters - b.distanceMeters);
  // total은 정렬·절단 전 반경 내 전체 수 — 캡 이후 길이를 쓰면 "50건 중 12건"이
  // 아니라 "50건 중 12건"으로 상한이 진짜 수를 가린다.
  return { events: inRadius.slice(0, SERVER_CAP), total: inRadius.length };
}
