import type { Place } from "./types";

/**
 * 채팅 카드 → 장소 상세 진입 요청 브릿지(모듈 싱글턴, React/Next 비의존).
 * ChatOverlay 마운트점이 여러 곳이라 콜백 스레딩 대신 이벤트로 PlaceSearch에
 * 전달한다(geolocation.ts 공유 스토어와 동형 패턴). 구독자(PlaceSearch)가
 * 없으면 no-op — 카드 쪽은 발행만 책임진다.
 */
type Listener = (place: Place) => void;
const listeners = new Set<Listener>();

export function subscribeOpenPlace(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOpenPlace(place: Place): void {
  for (const l of listeners) l(place);
}

/** 테스트 전용 — 구독자 초기화. */
export function __resetOpenPlaceForTest(): void {
  listeners.clear();
}
