"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, Loader2, MicOff } from "lucide-react";
import {
  useVoiceRecorder,
  type VoiceRecorderErrorCode,
} from "@/hooks/useVoiceRecorder";
import { useRecordingSound } from "@/hooks/useRecordingSound";

/**
 * 음성 받아쓰기 버튼 — 탭-토글(탭=시작, 다시 탭=정지·전사), Esc=취소.
 * dodo-planet에서 수입·적응(토스트/모달 제거, gildongmu 토큰·aria-live).
 *
 * 시작/정지/취소는 효과음으로 통지(useRecordingSound) — 매 토글마다 장황한 음성
 * 안내가 거슬린다는 피드백에 따라 비언어 신호로 바꿨다. 상승음=시작·하강음=정지·
 * 단음=취소로 방향이 직관적이고, 스크린 리더에는 버튼의 aria-label 변화("음성으로
 * 검색"→"받아쓰기 중지")만으로 상태를 전달한다 — 별도 live region "진행 중" 알림이나
 * aria-busy 상태 낭독은 두지 않는다(과잉 통지 제거). 시작 성공 시 버튼에 명시적
 * 재포커스해 SR 커서를 버튼에 고정하고 바뀐 라벨을 그 자리에서 읽게 한다.
 *
 * 라이브 리전(a11y C1): 전사 성공 시 인식 텍스트·결과 수는 부모 PlaceSearch의
 * polite status 한 채널로만 통지된다. 이 버튼의 assertive announcer는 이제
 * "오류 통지" 전용이다(시작/정지/취소는 효과음이 담당).
 *
 * 오류 i18n(a11y C2): 녹음 훅은 오류를 코드로만 던지고, 여기서 로케일별로
 * 번역(`voice.errors.{code}`)한다 — 외국어 사용자가 한국어 오류를 듣지 않게.
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { playStart, playStop, playCancel } = useRecordingSound();

  // 오류 통지 전용 announcer(시작/정지/취소는 효과음). 2초 뒤 비워 잔상 방지.
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
    // 실제 시작 성공 후에만 시작음 — 권한 실패 시 신호 역전 방지(Minor 8).
    // 실패 경로는 훅의 onError 코드가 announce(오류는 효과음 아닌 음성 통지).
    const ok = await startRecording();
    if (ok) playStart();
    return ok;
  }, [playStart, startRecording]);

  const handleClick = useCallback(async () => {
    if (!isSupported || state === "processing") return;
    if (state === "recording") {
      playStop();
      await stopRecording();
      return;
    }
    // idle → 곧장 녹음 시작. 권한이 필요하면 startRecording 내부의 getUserMedia가
    // 네이티브 프롬프트를 띄우고, 거부/실패를 NotAllowedError 기준으로 정확히
    // 분류한다(mic_denied vs mic_failed). 별도 권한 사전요청(requestPermission)을
    // 두지 않아 getUserMedia 중복 호출과 "장치 없음도 mic_denied"로 뭉개던
    // 오분류를 함께 제거한다(codex 잔여 #3 — 단일 분류 경로).
    const ok = await beginRecording();
    // 시작 성공 시 이 버튼에 포커스를 고정 — getUserMedia 비동기 대기 중 SR 커서가
    // 버튼을 이탈하는 것을 되돌리고, 바뀐 라벨("받아쓰기 중지")을 버튼에서 읽게 한다.
    // 언마운트되면 ref가 null이라 안전한 no-op.
    if (ok) buttonRef.current?.focus();
  }, [isSupported, state, beginRecording, stopRecording, playStop]);

  // Esc로 녹음 취소 (IME 조합 중에는 무시 — 한글/일본어 입력 확정과 충돌 방지)
  // 취소는 전역 keydown이라 포커스가 버튼 밖일 수 있고, 음소거 환경에선 효과음을
  // 못 듣는다 → 시작/정지와 달리 취소만 효과음 + 음성 통지를 병행해 인지 사각을
  // 메운다(버튼에 포커스가 없어 aria-label 변화로도 알 수 없는 경우 대비).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === "Escape" && state === "recording") {
        playCancel();
        announce(t("cancelled"));
        cancelRecording();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancelRecording, playCancel, announce, t]);

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
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        aria-disabled={state === "processing"}
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
