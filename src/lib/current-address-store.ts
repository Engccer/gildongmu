/**
 * 현재 위치(GPS) 좌표의 대표 주소 캐시 (React/Next 비의존 — 브라우저 런타임 전용).
 *
 * 왜 공유 스토어인가:
 * 현재 위치 표시줄(`LocationBar`)은 채팅·검색·"내 주변" 세 화면 첫 줄에 있다. 각
 * 인스턴스가 스스로 역지오코딩하면 같은 좌표를 3번 조회한다. 스토어 하나가 좌표
 * 키 단위로 결과를 들고 있으면 화면을 오가도 조회는 좌표당 1회다
 * (`geolocation.ts`와 같은 모듈 싱글턴 패턴).
 *
 * **좌표당 1회이고 재시도하지 않는다.** 실패·미매칭도 `{key, address: null}`로
 * 확정 기록해 같은 좌표를 다시 조회하지 않는다. 주소는 부가 정보이므로 모르면
 * 라벨이 "현재 위치"로 남는 것이 정답이고(3-state 정직성), 재시도 루프는 라벨을
 * 뒤늦게 바꿔 VoiceOver 재낭독만 만든다.
 *
 * ⚠ **좌표가 바뀌면 옛 주소를 먼저 버린다.** 새 좌표에 옛 주소를 붙여 두면 화면으로
 * 반증할 수 없는 거짓 위치 주장이 된다(iOS `coordinateForDisplay`가 낡은 좌표를
 * 막는 것과 같은 판단, 축만 다르다). 공유 위치 스토어는 `force` 없이는 좌표를
 * 갱신하지 않으므로 이 전이는 사용자가 새로고침했을 때만 일어난다.
 */
import { roundCoord } from "./coord-round";
import type { Coord } from "./types";

export type CurrentAddressEntry = { key: string; address: string | null };

/**
 * 캐시 키. 4자리 약 ±5.5m — GPS 오차보다 작아 같은 자리의 재조회를 만들지 않으면서,
 * 실제로 움직였으면 키가 갈린다(`roundCoord` 적용 판단 기준 그대로: 캐시가 있고
 * 반올림 오차가 결과를 못 바꾸는 곳).
 */
export function coordAddressKey(coord: Coord): string {
  return `${roundCoord(coord.lat, 4)},${roundCoord(coord.lng, 4)}`;
}

const listeners = new Set<() => void>();
let entry: CurrentAddressEntry | null = null;
let inflightKey: string | null = null;

function emit() {
  for (const l of listeners) l();
}

export function subscribeCurrentAddress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentAddressSnapshot(): CurrentAddressEntry | null {
  return entry;
}

/** 서버 스냅샷은 항상 null(stable 참조) — hydration 안전. */
export function getCurrentAddressServerSnapshot(): CurrentAddressEntry | null {
  return null;
}

/**
 * 좌표 → 대표 주소. 매칭 없음·실패 모두 조용히 null(라벨은 "현재 위치"만 남아
 * 거짓 표시가 없다). `DirectionsView.fetchCurrentAddress`와 같은 라우트·같은 계약.
 */
async function fetchAddress(coord: Coord): Promise<string | null> {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${coord.lat}&lng=${coord.lng}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { address: string | null };
    return body.address;
  } catch {
    return null;
  }
}

/**
 * 이 좌표의 주소를 확보한다. 이미 확정됐거나 같은 좌표가 조회 중이면 no-op이라
 * 여러 표시줄이 동시에 불러도 요청은 하나다.
 */
export function ensureCurrentAddress(coord: Coord): void {
  const key = coordAddressKey(coord);
  if (entry?.key === key || inflightKey === key) return;
  inflightKey = key;
  if (entry) {
    entry = null;
    emit();
  }
  void fetchAddress(coord).then((address) => {
    // 더 새 좌표가 앞질렀으면 이 응답은 옛 자리의 주소다(latest-wins).
    if (inflightKey !== key) return;
    inflightKey = null;
    entry = { key, address };
    emit();
  });
}

/** 테스트 전용 — 모듈 상태 초기화(fetch mock 교체 사이). */
export function __resetCurrentAddressForTest(): void {
  entry = null;
  inflightKey = null;
  listeners.clear();
}
