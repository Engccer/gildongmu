"use client";

import { useSyncExternalStore } from "react";
import type { ManualLocation } from "@/lib/manual-location";
import {
  getManualLocation,
  getManualLocationServerSnapshot,
  subscribeManualLocation,
} from "@/lib/manual-location-store";

/** 수동 위치 구독 훅. 쓰기는 스토어 함수를 직접 import 한다(useGeolocation 동형). */
export function useManualLocation(): ManualLocation | null {
  return useSyncExternalStore(
    subscribeManualLocation,
    getManualLocation,
    getManualLocationServerSnapshot,
  );
}
