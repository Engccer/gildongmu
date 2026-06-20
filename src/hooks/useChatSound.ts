"use client";

import { useCallback } from "react";
import { SEND_TONES, RECEIVE_TONES } from "@/lib/chat-tones";
import { useTonePlayer } from "./useTonePlayer";

/**
 * 채팅 대화 턴의 경계를 알리는 비언어 효과음.
 * Web Audio 합성 코어는 useTonePlayer가 담당하고, 여기서는 채팅 도메인의
 * 톤 시퀀스(단음=제출·2음 상승=응답 완료)를 바인딩한다.
 *
 * - playSend: 프롬프트 제출 직후(사용자 제스처 콜스택) 호출 → autoplay 정책 안전.
 * - playReceive: 응답 완료 시 호출. 직전 제출로 AudioContext가 이미 unlock된 상태라
 *   사용자 제스처가 아니어도 재생된다.
 */
export function useChatSound() {
  const { play } = useTonePlayer();
  const playSend = useCallback(() => play(SEND_TONES), [play]);
  const playReceive = useCallback(() => play(RECEIVE_TONES), [play]);
  return { playSend, playReceive };
}
