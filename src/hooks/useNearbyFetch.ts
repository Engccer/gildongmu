"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { awaitGeolocation } from "@/lib/geolocation";
import { awaitManualLocation } from "@/lib/effective-location";
import { isInKorea } from "@/lib/coverage";
import {
  isOutOfCoverageBody,
  unavailableHereReason,
  type UnavailableHereReason,
} from "@/lib/out-of-coverage";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

export type NearbyStatus<T> =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  /**
   * 결과 0건. `detail`은 0건이어도 사용자에게 말할 것이 있는 도메인만 싣는다
   * (지하철 = 반경 밖 최근접 역). 없으면 순수한 0건이다.
   */
  | { kind: "empty"; detail?: T }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  /** 한국 안이지만 그 도메인 데이터가 이 지역에 없음(따릉이·문화행사 = 서울 전용). */
  | { kind: "unavailableHere"; reason: UnavailableHereReason }
  | { kind: "done"; data: T; at: string };

export type NearbySource =
  | { kind: "current"; autoLoad?: boolean }
  | { kind: "place"; lat: number; lng: number };

interface Options<T> {
  source: NearbySource;
  /** "korea": 클라 선분기 + 응답 마커(기본). "none": WalkInfra(전 지구 OSM — 스펙 §4). */
  coverage?: "korea" | "none";
  /** URL·쿼리 조립은 도메인 몫 — 훅은 호출·해석·상태만 소유한다(스펙 §2). */
  fetchAt: (coords: { lat: number; lng: number }) => Promise<Response>;
  /** 순수 함수(외부 setter 호출 금지). empty 개념 없는 도메인은 항상 done 반환. */
  parse: (body: unknown) => { kind: "done"; data: T } | { kind: "empty"; detail?: T };
  /** close 시 도메인 부수 상태 리셋(BarrierFree 캐시, BusArrivals notice). close 한정. */
  onClose?: () => void;
}

/**
 * nearby 계열 위치 취득 → fetch 상태 머신의 정본(9종 공유, 스펙 §2).
 *
 * 잠복 결함 수정(스펙 §3, 유일한 의도적 행동 변경): 단조 증가 요청 ID로
 * latest-wins를 보장한다. load·close마다 ID가 증가하고, 캡처 ID ≠ 현재 ID면
 * ① 위치 도착 후 fetch를 시작하지 않으며(쿼터·좌표 전송 방지)
 * ② 응답·복원·geoerror 등 어떤 상태도 반영하지 않는다.
 * in-flight 잠금도 boolean 대신 ID — 이전 요청의 해제가 새 요청의 잠금을 풀지 못한다.
 */
export function useNearbyFetch<T>({ source, coverage = "korea", fetchAt, parse, onClose }: Options<T>) {
  const [status, setStatus] = useState<NearbyStatus<T>>({ kind: "idle" });
  /** done 커밋마다 증가 — useRevealMore의 표시 수 리셋 신호(내부 배선, 포커스 신호 아님). */
  const [doneSeq, setDoneSeq] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);
  const seqRef = useRef(0);
  const lockRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /** 홈/허브 아코디언 참여 조건 — place(상세 단일 패널)·autoLoad(채팅 카드)는 불참. */
  const participates = source.kind === "current" && !source.autoLoad;

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    seqRef.current += 1;
    lockRef.current = null;
    setStatus({ kind: "idle" });
    onCloseRef.current?.();
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: participates && status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  function load(force = false) {
    const prevStatus = status;
    if (participates) claim();
    if (lockRef.current !== null) return;
    const id = (seqRef.current += 1);
    lockRef.current = id;
    const unlock = () => {
      if (lockRef.current === id) lockRef.current = null;
    };
    const run = async (lat: number, lng: number) => {
      setStatus({ kind: "loading" });
      try {
        const res = await fetchAt({ lat, lng });
        const body = await res.json();
        if (seqRef.current !== id) return; // 검사지점 ② — 반영 직전(스펙 §3)
        if (coverage === "korea" && isOutOfCoverageBody(body)) {
          setStatus({ kind: "outOfCoverage" });
          return;
        }
        // 서비스 지역 미제공 — coverage 옵션과 무관하다(전 지구 도메인도 낼 수 있고,
        // 이 마커를 내지 않는 도메인은 애초에 여기 걸리지 않는다).
        const unavailable = unavailableHereReason(body);
        if (unavailable) {
          setStatus({ kind: "unavailableHere", reason: unavailable });
          return;
        }
        if (!res.ok) {
          setStatus({ kind: "error" });
          return;
        }
        const parsed = parse(body);
        if (parsed.kind === "empty") {
          setStatus({ kind: "empty", detail: parsed.detail });
          return;
        }
        const at = new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
        setStatus({ kind: "done", data: parsed.data, at });
        setDoneSeq((s) => s + 1);
      } catch {
        if (seqRef.current !== id) return;
        setStatus({ kind: "error" });
      }
    };
    if (source.kind === "place") {
      void run(source.lat, source.lng).finally(unlock);
      return;
    }
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
    const gpsPath = () =>
      awaitGeolocation({ force }).then((g) => {
        if (seqRef.current !== id) {
          // 검사지점 ① — 닫힌(또는 대체된) 요청의 위치로 upstream을 호출하지 않는다.
          unlock();
          return;
        }
        if (g.status === "ready") {
          if (coverage === "korea" && !isInKorea(g.coords.lat, g.coords.lng)) {
            setStatus({ kind: "outOfCoverage" });
            unlock();
            return;
          }
          void run(g.coords.lat, g.coords.lng).finally(unlock);
        } else {
          // 새로고침(force) 실패 시 보던 데이터를 잃지 않는다 — done이면 직전 결과를
          // 복원하고, 첫 조회 실패면 geoerror(실내 GPS 재취득 실패로 데이터 소멸 방지).
          setStatus(
            prevStatus.kind === "done"
              ? prevStatus
              : {
                  kind: "geoerror",
                  reason: g.status === "unsupported" ? "unsupported" : "denied",
                },
          );
          unlock();
        }
      });

    setStatus({ kind: "locating" });
    // 좌표 우선순위는 **장소 앵커 > 수동 위치 > GPS**다. 앵커는 위 선분기가 이미
    // 처리했으므로 여기서는 수동 위치를 먼저 본다. force면 그 전에 이동 판정이
    // 돌아, 사용자가 자리를 옮겼으면 수동 위치가 해제된 뒤 GPS 경로로 떨어진다.
    void awaitManualLocation({ force }).then((manual) => {
      if (seqRef.current !== id) {
        unlock();
        return;
      }
      if (!manual) {
        // 수동 위치가 없으면 기존 GPS 경로 그대로. 실패 분기(직전 데이터 복원·
        // unsupported/denied 구분)는 이 훅의 계약이라 상위 계층으로 흡수하지 않는다.
        void gpsPath();
        return;
      }
      if (coverage === "korea" && !isInKorea(manual.lat, manual.lng)) {
        setStatus({ kind: "outOfCoverage" });
        unlock();
        return;
      }
      void run(manual.lat, manual.lng).finally(unlock);
    });
  }

  // autoLoad(채팅 카드): 마운트 시 자동 로드. 의존성 배열 비움은 의도적 — 1회만.
  // load의 동기 setState(locating)를 queueMicrotask로 한 틱 미뤄
  // react-hooks/set-state-in-effect를 정석대로 만족시킨다(PlaceSearch 동형).
  // 중복 실행 방지는 그대로 lockRef가 맡는다(StrictMode 이중 마운트 포함).
  useEffect(() => {
    if (source.kind === "current" && source.autoLoad) queueMicrotask(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // done 진입 시 결과 헤딩으로 포커스 이동(접근성 1급). fetch 완료 직후 rAF로
  // 옮기면 React 커밋과 인과관계가 없어 레이스가 생긴다 — useEffect는 커밋 이후
  // 실행이 보장되므로 안전하다(PlaceDetail·PlaceSearch 동형).
  useEffect(() => {
    if (status.kind === "done") {
      if (!focusedRef.current) {
        focusedRef.current = true;
        headingRef.current?.focus();
      }
    } else {
      focusedRef.current = false;
    }
  }, [status.kind]);

  const busy = status.kind === "locating" || status.kind === "loading";

  return { status, doneSeq, load, close, busy, headingRef, triggerRef };
}
