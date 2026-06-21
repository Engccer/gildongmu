"use client";

import { useCallback, useRef, useState } from "react";
import type { Place } from "@/lib/types";

/**
 * 근처 결과 항목에서 장소별 채팅 오버레이(ChatOverlay)를 여는 런처 훅.
 *
 * 한 리스트의 여러 항목이 각자 채팅을 열 수 있으므로 "지금 열린 장소"와 "그 채팅을
 * 연 트리거 버튼"을 추적해 컴포넌트당 ChatOverlay 하나만 마운트한다. 닫을 때 트리거
 * 버튼으로 포커스를 복귀시킨다(PlaceDetail 런처와 동형 — 맥락 유지).
 *
 * isChatOpen은 호출부에서 useNearbyPanel의 engaged를 `status!==idle && !isChatOpen`
 * 으로 내려, 채팅이 열린 동안 밑 패널의 전역 Esc·자동닫힘을 비활성화하는 데 쓴다
 * (Esc 한 번에 채팅과 패널이 함께 닫히는 경합 차단).
 */
export function usePlaceChat() {
  const [chatPlace, setChatPlace] = useState<Place | null>(null);
  const triggerElRef = useRef<HTMLElement | null>(null);

  const openChat = useCallback((place: Place, trigger: HTMLElement) => {
    triggerElRef.current = trigger;
    setChatPlace(place);
  }, []);

  const closeChat = useCallback(() => {
    setChatPlace(null);
    // 오버레이 언마운트 후 트리거 버튼으로 포커스 복귀(맥락 유지).
    const el = triggerElRef.current;
    triggerElRef.current = null; // stale DOM 참조 즉시 해제
    requestAnimationFrame(() => el?.focus());
  }, []);

  return { chatPlace, isChatOpen: chatPlace !== null, openChat, closeChat };
}
