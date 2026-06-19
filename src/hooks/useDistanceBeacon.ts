"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beaconStep,
  INITIAL_BEACON_STATE,
  type BeaconState,
  type BeaconAnnounce,
  type AnnounceKind,
} from "@/lib/beacon";
import { useBeaconSound } from "./useBeaconSound";
import { useScreenWakeLock } from "./useScreenWakeLock";

export type BeaconStatus = "idle" | "tracking" | "denied" | "unsupported";

const TONE_THROTTLE_MS = 2000;

/**
 * 거리 비콘 오케스트레이터. watchPosition 생명주기를 쥐고, 매 fix를 순수
 * beaconStep에 위임한 뒤 결과(announce)를 톤·음성(live region용 상태)·Wake Lock으로
 * 라우팅한다. 결정 로직은 beacon.ts에 있고 여기는 I/O·throttle·정리만 담당한다.
 */
export function useDistanceBeacon(
  destLat: number,
  destLng: number,
): {
  status: BeaconStatus;
  announce: BeaconAnnounce | null;
  supported: boolean;
  toggle: () => void;
} {
  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [announce, setAnnounce] = useState<BeaconAnnounce | null>(null);

  const stateRef = useRef<BeaconState>(INITIAL_BEACON_STATE);
  const watchIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastToneAtRef = useRef(0);
  const prevKindRef = useRef<AnnounceKind | null>(null);

  const { playCloser, playFarther, playNearby, playTick, playStart, playStop } =
    useBeaconSound();
  const wakeLock = useScreenWakeLock();

  const supported =
    typeof navigator !== "undefined" && !!navigator.geolocation;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const routeTone = useCallback(
    (kind: BeaconAnnounce["kind"]) => {
      // nearby 도착음은 throttle 없이 항상(중요 이벤트).
      if (kind === "nearby") {
        playNearby();
        lastToneAtRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (now - lastToneAtRef.current < TONE_THROTTLE_MS) return;
      lastToneAtRef.current = now;
      if (kind === "closer") playCloser();
      else if (kind === "farther") playFarther();
      else if (kind === "hold") playTick();
      // first·weak: 톤 없음.
    },
    [playCloser, playFarther, playNearby, playTick],
  );

  const stop = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    prevKindRef.current = null;
    void wakeLock.release();
    stateRef.current = INITIAL_BEACON_STATE;
    if (mountedRef.current) {
      setStatus("idle");
      setAnnounce(null);
    }
    playStop();
  }, [wakeLock, playStop]);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null) return;
    stateRef.current = INITIAL_BEACON_STATE;
    prevKindRef.current = null;
    setStatus("tracking");
    setAnnounce(null);
    playStart();
    void wakeLock.acquire();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!mountedRef.current) return;
        const result = beaconStep(
          stateRef.current,
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          { lat: destLat, lng: destLng },
        );
        stateRef.current = result.state;
        // weak가 연속될 때는 재방출하지 않는다(polite live region SR 스팸 방지).
        // 비-weak→weak 전이 1회만 통지(신호 약함을 1회 알리되 반복 낭독 회피).
        if (result.announce.kind === "weak" && prevKindRef.current === "weak") {
          return;
        }
        prevKindRef.current = result.announce.kind;
        setAnnounce(result.announce);
        routeTone(result.announce.kind);
      },
      (err) => {
        if (!mountedRef.current) return;
        if (err.code === err.PERMISSION_DENIED) {
          if (
            watchIdRef.current !== null &&
            navigator.geolocation
          ) {
            navigator.geolocation.clearWatch(watchIdRef.current);
          }
          watchIdRef.current = null;
          prevKindRef.current = null;
          void wakeLock.release();
          setStatus("denied");
          setAnnounce(null);
        } else {
          // POSITION_UNAVAILABLE·TIMEOUT: 추적 유지, 신호 약함만(전이 1회) 표시.
          if (prevKindRef.current === "weak") return;
          prevKindRef.current = "weak";
          setAnnounce({ kind: "weak", distance: 0, accuracy: 0, speak: false });
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [supported, destLat, destLng, wakeLock, playStart, routeTone]);

  // 언마운트 정리.
  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      void wakeLock.release();
    };
  }, [wakeLock]);

  const toggle = useCallback(() => {
    if (status === "tracking") stop();
    else start();
  }, [status, start, stop]);

  return { status, announce, supported, toggle };
}
