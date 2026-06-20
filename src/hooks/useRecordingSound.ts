"use client";

import { useCallback } from "react";
import { START_TONES, STOP_TONES, CANCEL_TONES } from "@/lib/recording-tones";
import { useTonePlayer } from "./useTonePlayer";

/**
 * 음성 받아쓰기 시작/정지/취소를 알리는 비언어 효과음.
 * Web Audio 합성 코어는 useTonePlayer가 담당하고, 여기서는 녹음 도메인의
 * 톤 시퀀스(상승=시작·하강=정지·단음=취소)를 바인딩한다.
 */
export function useRecordingSound() {
  const { play } = useTonePlayer();
  const playStart = useCallback(() => play(START_TONES), [play]);
  const playStop = useCallback(() => play(STOP_TONES), [play]);
  const playCancel = useCallback(() => play(CANCEL_TONES), [play]);
  return { playStart, playStop, playCancel };
}
