"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Coord } from "@/lib/types";
import {
  coordAddressKey,
  ensureCurrentAddress,
  getCurrentAddressServerSnapshot,
  getCurrentAddressSnapshot,
  subscribeCurrentAddress,
} from "@/lib/current-address-store";

/**
 * 좌표의 대표 주소를 구독한다. **조회 트리거까지 이 훅 하나가 한다** — 호출부가
 * 구독과 `ensureCurrentAddress` 호출을 각자 하면 한쪽만 놓친 진입점이 조용히
 * 주소 없는 라벨을 낸다([[gildongmu-search-entrypoint-dry-regression]] 동형).
 *
 * `coord`가 null이면 조회하지 않고 null을 돌려준다 — 좌표 미확보(측위 전·권한
 * 없음)와 "주소를 표시하지 않기로 한 상태"(수동 위치)를 호출부가 같은 방식으로
 * 표현할 수 있다.
 *
 * 반환값은 **인자로 준 좌표의 주소일 때만** 비어 있지 않다. 스토어가 다른 좌표의
 * 주소를 들고 있는 순간(새로고침 직후)에 그것을 흘리지 않는다.
 */
export function useCurrentAddress(coord: Coord | null): string | null {
  const entry = useSyncExternalStore(
    subscribeCurrentAddress,
    getCurrentAddressSnapshot,
    getCurrentAddressServerSnapshot,
  );
  // 좌표 객체는 매 렌더 새로 만들어질 수 있으므로 의존은 값으로 건다.
  const lat = coord?.lat ?? null;
  const lng = coord?.lng ?? null;
  useEffect(() => {
    if (lat === null || lng === null) return;
    ensureCurrentAddress({ lat, lng });
  }, [lat, lng]);

  if (!coord) return null;
  return entry?.key === coordAddressKey(coord) ? entry.address : null;
}
