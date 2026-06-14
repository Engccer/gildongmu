"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, Loader2, MicOff } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";

/**
 * 음성 받아쓰기 버튼 — 탭-토글(탭=시작, 다시 탭=정지·전사), Esc=취소.
 * dodo-planet에서 수입·적응(토스트/사운드/모달 제거, gildongmu 토큰·aria-live).
 * 상태 변화는 sr-only aria-live(assertive)로 통지. 오류는 onError로 부모에도 전달.
 */
export function VoiceRecordButton({
  onTranscribed,
  onError,
}: {
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
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

  const { state, startRecording, stopRecording, cancelRecording, isSupported } =
    useVoiceRecorder({
      maxDuration: 60,
      locale,
      onTranscribed: (text) => {
        announce(t("transcribed", { text }));
        onTranscribed(text);
      },
      onError: (msg) => {
        announce(msg);
        onError?.(msg);
      },
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
      announce(t("permissionDenied"));
      onError?.(t("permissionDenied"));
    } else {
      // needsPermission → 네이티브 프롬프트로 직접 요청
      const granted = await requestPermission();
      if (granted) await beginRecording();
      else {
        announce(t("permissionDenied"));
        onError?.(t("permissionDenied"));
      }
    }
  }, [
    isSupported, state, permissionState, checkPermission, requestPermission,
    beginRecording, stopRecording, announce, t, onError,
  ]);

  // Esc로 녹음 취소
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
