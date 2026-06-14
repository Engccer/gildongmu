"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, Loader2, MicOff } from "lucide-react";
import {
  useVoiceRecorder,
  type VoiceRecorderErrorCode,
} from "@/hooks/useVoiceRecorder";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";

/**
 * 음성 받아쓰기 버튼 — 탭-토글(탭=시작, 다시 탭=정지·전사), Esc=취소.
 * dodo-planet에서 수입·적응(토스트/사운드/모달 제거, gildongmu 토큰·aria-live).
 *
 * 라이브 리전 단일화(a11y C1): 전사 성공 시 이 버튼의 assertive announcer는
 * 침묵한다 — 인식 텍스트·결과 수는 부모 PlaceSearch의 polite status 한 채널로만
 * 순차 통지된다. 이 announcer는 started/stopped/cancelled/오류 통지용으로만 유지.
 *
 * 오류 i18n(a11y C2): 녹음 훅은 오류를 코드로만 던지고, 여기서 로케일별로
 * 번역(`voice.errors.{code}`)한다 — en 사용자가 한국어 오류를 듣지 않게.
 */
export function VoiceRecordButton({
  onTranscribed,
  onError,
}: {
  onTranscribed: (text: string) => void;
  onError?: (code: VoiceRecorderErrorCode) => void;
}) {
  const t = useTranslations("voice");
  const locale = useLocale();
  const announcerRef = useRef<HTMLDivElement>(null);
  const { permissionState, checkPermission, requestPermission } =
    useMicrophonePermission();

  const announce = useCallback((msg: string) => {
    if (announcerRef.current) {
      announcerRef.current.textContent = msg;
      setTimeout(() => {
        if (announcerRef.current) announcerRef.current.textContent = "";
      }, 2000);
    }
  }, []);

  // 오류 코드를 로케일 번역해 통지 + 부모에게 코드 전달(부모는 검색 영역 처리).
  const reportError = useCallback(
    (code: VoiceRecorderErrorCode) => {
      announce(t(`errors.${code}`));
      onError?.(code);
    },
    [announce, t, onError],
  );

  const { state, startRecording, stopRecording, cancelRecording, isSupported } =
    useVoiceRecorder({
      maxDuration: 60,
      locale,
      // C1: 전사 성공 시 assertive announce를 하지 않는다 — 인식 텍스트는
      // 부모의 polite status 한 채널로만 통지(라이브 리전 경합 제거).
      onTranscribed,
      onError: reportError,
    });

  const beginRecording = useCallback(async () => {
    announce(t("started"));
    await startRecording();
  }, [announce, t, startRecording]);

  const handleClick = useCallback(async () => {
    if (!isSupported || state === "processing") return;
    if (state === "recording") {
      announce(t("stopped"));
      await stopRecording();
      return;
    }
    // idle → 권한 확인 후 녹음
    if (permissionState === "ready") {
      await beginRecording();
      return;
    }
    const result =
      permissionState === "idle" || permissionState === "checking"
        ? await checkPermission()
        : permissionState;
    if (result === "ready") {
      await beginRecording();
    } else if (result === "denied") {
      reportError("mic_denied");
    } else {
      // needsPermission → 네이티브 프롬프트로 직접 요청
      const granted = await requestPermission();
      if (granted) await beginRecording();
      else reportError("mic_denied");
    }
  }, [
    isSupported, state, permissionState, checkPermission, requestPermission,
    beginRecording, stopRecording, reportError, announce, t,
  ]);

  // Esc로 녹음 취소 (IME 조합 중에는 무시 — 한글/일본어 입력 확정과 충돌 방지)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === "Escape" && state === "recording") {
        announce(t("cancelled"));
        cancelRecording();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancelRecording, announce, t]);

  if (!isSupported) {
    // 미지원 브라우저: 버튼 자리에 아무것도 두지 않고 텍스트 검색만 — 단,
    // SR 사용자를 위해 비활성 버튼 + 안내를 둔다.
    return (
      <button
        type="button"
        aria-disabled="true"
        aria-label={t("notSupported")}
        className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-3 text-muted opacity-50"
      >
        <MicOff aria-hidden="true" className="h-5 w-5" />
      </button>
    );
  }

  const label =
    state === "recording" ? t("stop") : state === "processing" ? t("recognizing") : t("start");
  const icon =
    state === "recording" ? (
      <Square aria-hidden="true" className="h-5 w-5 fill-current" />
    ) : state === "processing" ? (
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
    ) : (
      <Mic aria-hidden="true" className="h-5 w-5" />
    );

  return (
    <>
      <div ref={announcerRef} role="status" aria-live="assertive" aria-atomic="true" className="sr-only" />
      <button
        type="button"
        onClick={handleClick}
        aria-disabled={state === "processing"}
        aria-busy={state === "recording" || state === "processing"}
        aria-label={label}
        className={
          "inline-flex min-h-12 items-center justify-center rounded-md border px-3 aria-disabled:opacity-50 " +
          (state === "recording"
            ? "border-red-600 bg-red-600 text-white"
            : "border-border text-accent")
        }
      >
        {icon}
      </button>
    </>
  );
}
