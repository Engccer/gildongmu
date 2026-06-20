"use client";

import { useSyncExternalStore } from "react";
import {
  subscribeMode,
  getModeSnapshot,
  getModeServerSnapshot,
  type AppMode,
} from "@/lib/chat/mode-state";

/**
 * 공유 검색/채팅 모드 스토어를 React에 노출하는 훅(useGeolocation 동형).
 * 서버 스냅샷은 stable "search"라 hydration 안전이며, 클라 마운트 후 URL·localStorage
 * 값으로 1회 재조정된다. 모드 전환은 lib의 setAppMode를 직접 호출한다.
 */
export function useAppMode(): AppMode {
  return useSyncExternalStore(
    subscribeMode,
    getModeSnapshot,
    getModeServerSnapshot,
  );
}
