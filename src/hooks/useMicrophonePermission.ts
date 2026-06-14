"use client";

import { useState, useCallback, useRef } from "react";

export type MicPermissionState =
  | "idle"            // 초기 상태
  | "checking"        // 권한 확인 중
  | "needsPermission" // 권한 필요 (프롬프트 표시)
  | "ready"           // 권한 있음, 녹음 준비 완료
  | "denied";         // 권한 거부됨

interface UseMicrophonePermissionReturn {
  permissionState: MicPermissionState;
  checkPermission: () => Promise<MicPermissionState>;
  requestPermission: () => Promise<boolean>;
  reset: () => void;
}

const STORAGE_KEY = "mic_permission_cache";

/**
 * 마이크 권한 관리 훅
 * - 권한 확인과 요청을 분리하여 UX 개선
 * - Safari 폴백 지원 (permissions.query 미지원)
 * - localStorage 캐싱으로 재방문 시 빠른 확인
 */
export function useMicrophonePermission(): UseMicrophonePermissionReturn {
  const [permissionState, setPermissionState] = useState<MicPermissionState>("idle");
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * 권한 상태만 확인 (실제 권한 요청 없음)
   * Safari는 permissions.query를 지원하지 않으므로 캐시 또는 prompt 반환
   */
  const checkPermission = useCallback(async (): Promise<MicPermissionState> => {
    setPermissionState("checking");

    try {
      // 1. Navigator Permissions API 시도 (Chrome, Firefox)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName });

          if (result.state === "granted") {
            setPermissionState("ready");
            localStorage.setItem(STORAGE_KEY, "granted");
            return "ready";
          } else if (result.state === "denied") {
            setPermissionState("denied");
            localStorage.setItem(STORAGE_KEY, "denied");
            return "denied";
          } else {
            // prompt 상태
            setPermissionState("needsPermission");
            return "needsPermission";
          }
        } catch {
          // permissions.query 실패 시 폴백
        }
      }

      // 2. Safari 폴백: localStorage 캐시 확인
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached === "granted") {
        setPermissionState("ready");
        return "ready";
      } else if (cached === "denied") {
        setPermissionState("denied");
        return "denied";
      }

      // 3. 캐시 없음 → 권한 요청 필요
      setPermissionState("needsPermission");
      return "needsPermission";
    } catch (error) {
      console.error("Error checking microphone permission:", error);
      setPermissionState("needsPermission");
      return "needsPermission";
    }
  }, []);

  /**
   * 실제 권한 요청 (getUserMedia 호출)
   * - 권한 허용 후 500ms 딜레이로 모바일 UX 버퍼 제공
   * - 스트림은 즉시 해제하여 리소스 정리
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setPermissionState("checking");

    try {
      // getUserMedia로 실제 권한 요청
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 스트림 즉시 해제 (권한 확인만 목적)
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      // 캐시 저장
      localStorage.setItem(STORAGE_KEY, "granted");

      // 모바일 UX 버퍼: 권한 팝업이 닫히고 앱으로 포커스가 돌아올 시간 확보
      await new Promise((resolve) => setTimeout(resolve, 500));

      setPermissionState("ready");
      return true;
    } catch (error) {
      console.error("Microphone permission denied:", error);

      // 권한 거부 여부 확인
      if (error instanceof Error && error.name === "NotAllowedError") {
        localStorage.setItem(STORAGE_KEY, "denied");
        setPermissionState("denied");
      } else {
        // 기타 오류 (장치 없음 등)
        setPermissionState("needsPermission");
      }

      return false;
    }
  }, []);

  /**
   * 상태 초기화
   */
  const reset = useCallback(() => {
    setPermissionState("idle");
  }, []);

  return {
    permissionState,
    checkPermission,
    requestPermission,
    reset,
  };
}
