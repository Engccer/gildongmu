"use client";

import { useCallback, useEffect, useId, useSyncExternalStore } from "react";
import {
  claimNearbyPanel,
  releaseNearbyPanel,
  subscribeNearbyPanel,
  getActiveNearbyPanel,
  getServerActiveNearbyPanel,
} from "@/lib/nearby-panel-store";

interface Options {
  /** 이 패널이 펼쳐져 화면을 점유 중인가(status.kind !== "idle"). Esc 리스너와
   *  자동 닫힘의 활성 조건. */
  engaged: boolean;
  /** 다른 패널이 점유를 가져가 조용히 닫을 때 호출(포커스 이동 없음 — 방금 누른
   *  다른 버튼에서 포커스를 빼앗지 않는다). */
  onDismiss: () => void;
  /** Esc로 닫을 때 호출(포커스를 trigger로 복귀 — 사용자가 이 패널에 있었다). */
  onEscape: () => void;
}

/**
 * 홈 "내 주변 둘러보기" 패널의 아코디언 동작을 컴포넌트에 부여한다.
 * - load 시작 시 `claim()`을 부르면 다른 펼쳐진 패널이 스스로 닫힌다(단일 점유).
 * - PC: 펼쳐진 동안 Esc로 닫는다.
 * - 다른 패널이 점유를 가져가면 이 패널은 onDismiss로 조용히 닫는다.
 *
 * 6종 nearby 컴포넌트가 공유 — 드리프트 방지(geolocation 공유 스토어와 동형).
 */
export function useNearbyPanel({ engaged, onDismiss, onEscape }: Options) {
  const id = useId();
  const active = useSyncExternalStore(
    subscribeNearbyPanel,
    getActiveNearbyPanel,
    getServerActiveNearbyPanel,
  );

  // 다른 패널이 점유를 가져가면(active가 내가 아닌 다른 id) 조용히 닫는다.
  useEffect(() => {
    if (engaged && active !== null && active !== id) {
      onDismiss();
    }
  }, [active, id, engaged, onDismiss]);

  // PC: 펼쳐진 동안 Esc로 닫는다(전역 keydown — 포커스 위치 무관).
  useEffect(() => {
    if (!engaged) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [engaged, onEscape]);

  // 닫힘(engaged: true→false, close 호출 결과) 시 점유를 해제한다. 과거엔
  // "닫힌 패널은 engaged=false라 자동닫힘 대상이 아니므로 stale activeId는
  // 무해하다"는 이유로 release를 부르지 않았으나, NearbyHub처럼 activeId
  // 유무만으로 "패널이 실제로 펼쳐져 있는가"를 판정하는 상위 소비자는 이
  // stale activeId를 영구 펼침으로 오판해 Esc-뒤로가기가 첫 패널 개폐 이후
  // 영구 비활성되는 회귀를 낳았다(2026-07-30). releaseNearbyPanel의
  // activeId!==id 가드가 있어 다른 패널이 이미 점유를 가져간 뒤(자동 닫힘
  // 경로)의 뒤늦은 release는 그 점유를 탈취하지 않는다 — release는 claim을
  // 부르지 않으므로 순환 의존도 없다(과거 우려 정정).
  useEffect(() => {
    if (!engaged) releaseNearbyPanel(id);
  }, [engaged, id]);

  // 언마운트 시에도 점유 해제(검색 시작으로 nearby가 통째로 언마운트되는 경우
  // 등 — 위 이펙트는 engaged=true인 채로 unmount되면 커버하지 못한다).
  useEffect(() => () => releaseNearbyPanel(id), [id]);

  const claim = useCallback(() => claimNearbyPanel(id), [id]);
  return { claim };
}
