"use client";

import { createContext, useContext, useEffect } from "react";
import type { AxisKey, AxisSource } from "@/lib/webmcp/tools/context";

export interface PlaceBridgeRegistrar {
  attach(axis: AxisKey, source: AxisSource): () => void;
  /** 소스 상태가 커밋됐다 — 정착 대기자가 `read()`를 다시 본다. */
  notifyCommit(): void;
}

/** `PlaceDetail`이 제공한다. 상세 밖에서 렌더되는 역 섹션(있다면)은 null을 보고 아무것도 하지 않는다. */
export const PlaceBridgeContext = createContext<PlaceBridgeRegistrar | null>(null);

/**
 * 역 섹션이 자기 축의 상태 소스·`load` 핸들러를 채워 넣는다(spec §5.4). 엔트리 자체는
 * `PlaceDetail`이 만든다 — 자식 등록 여부가 `present`를 정하지 않는다(게시 직후 미등록 창의
 * 거짓 `notConfigured` 차단, 리뷰 #2).
 */
export function useAxisBridge(axis: AxisKey, source: AxisSource | null, revision: unknown): void {
  const registrar = useContext(PlaceBridgeContext);
  useEffect(() => {
    if (!registrar || !source) return;
    return registrar.attach(axis, source);
  }, [registrar, axis, source]);
  // 정착 판정은 **소스 상태가 커밋된 뒤**여야 한다. 자식 setState는 부모 effect를 돌리지 않으므로
  // 부모가 아니라 여기서 통지한다(`revision`은 컴포넌트 status 값 — statusRef 갱신 effect보다 뒤에
  // 선언돼야 대기자가 새 값을 읽는다).
  useEffect(() => {
    registrar?.notifyCommit();
  }, [registrar, revision]);
}
