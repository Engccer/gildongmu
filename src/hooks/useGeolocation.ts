"use client";

import { useSyncExternalStore } from "react";
import {
  getGeolocationSnapshot,
  getGeolocationServerSnapshot,
  subscribeGeolocation,
  type GeoState,
} from "@/lib/geolocation";

/**
 * 공유 위치 스토어를 React에 노출하는 훅. 컴포넌트는 현재 GeoState를 구독하고,
 * 좌표 요청 자체는 lib의 requestLocation/awaitGeolocation을 직접 호출한다(스토어가
 * 세션 1회 획득·캐시를 보장). 서버 스냅샷은 stable idle이라 hydration 안전.
 */
export function useGeolocation(): GeoState {
  return useSyncExternalStore(
    subscribeGeolocation,
    getGeolocationSnapshot,
    getGeolocationServerSnapshot,
  );
}
