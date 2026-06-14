"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";

export type RecordingState = "idle" | "recording" | "processing";

// 브라우저 음성 입력 지원 여부 — useSyncExternalStore로 서버/클라 스냅샷을
// 분리해 hydration mismatch를 막는다(LanguageSwitcher와 동일 패턴).
// 값이 마운트 중 바뀌지 않으므로 subscribe는 noop.
const subscribeSupport = () => () => {};
const getSupportSnapshot = () =>
  !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
const getSupportServerSnapshot = () => false;

/**
 * 오류 코드 — 로케일별 번역은 소비 컴포넌트(VoiceRecordButton)가 담당한다.
 * 훅은 사람이 읽는 문자열을 직접 만들지 않는다(en 사용자가 한국어를 듣는 결함 차단).
 */
export type VoiceRecorderErrorCode =
  | "mic_denied" // 마이크 권한 거부(NotAllowedError)
  | "mic_failed" // 그 외 마이크 시작 실패(장치 없음 등)
  | "no_audio" // 녹음된 오디오 청크 없음
  | "too_short" // 최소 길이(0.3초) 미달
  | "no_text" // STT 422 — 음성을 텍스트로 인식 못 함
  | "stt_failed"; // 그 외 STT 실패/네트워크/예외

interface UseVoiceRecorderOptions {
  maxDuration?: number; // Maximum recording duration in seconds (default: 60)
  locale?: string; // UI locale hint for speech recognition (ko, en, es, fr)
  onTranscribed?: (text: string) => void; // Callback when transcription is complete
  onError?: (code: VoiceRecorderErrorCode) => void; // Callback on error (코드만 — 번역은 소비자 담당)
}

interface UseVoiceRecorderReturn {
  state: RecordingState;
  duration: number; // Current recording duration in seconds
  startRecording: () => Promise<boolean>; // true = 실제 녹음 시작됨
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
  isSupported: boolean;
}

export function useVoiceRecorder(
  options: UseVoiceRecorderOptions = {}
): UseVoiceRecorderReturn {
  const { maxDuration = 60, locale, onTranscribed, onError } = options;

  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  // hydration-safe 지원 감지: 서버 스냅샷 false, 클라 스냅샷 실제 기능 검사.
  // lazy useState는 클라 첫 렌더에서 true가 되어 서버(false)와 mismatch + 깜빡임을
  // 일으켰다(codex Important 1). useSyncExternalStore가 두 스냅샷을 분리한다.
  const isSupported = useSyncExternalStore(
    subscribeSupport,
    getSupportSnapshot,
    getSupportServerSnapshot,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  // 마운트 생존 여부(Important 4) — 언마운트 후 setState/콜백 발화 방지.
  const mountedRef = useRef(true);
  // 진행 중(in-flight) 잠금(Important 2) — 빠른 더블탭의 중복 getUserMedia 차단.
  const busyRef = useRef(false);
  // 진행 중 STT fetch 취소용(Important 4).
  const abortRef = useRef<AbortController | null>(null);
  // startRecording의 타이머 콜백이 후순위로 선언되는 stopRecording을 호출해야 해
  // 순환 참조가 생긴다. 직접 참조(=선언 전 접근)는 React Compiler 규칙
  // (immutability/preserve-manual-memoization)을 깨므로, ref로 최신 stopRecording을
  // 가리켜 콜백이 항상 현재 버전을 호출하도록 우회한다(동작 동일, 정석 패턴).
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Cleanup on unmount — 타이머·스트림 정리 + 마운트 플래그 해제 + STT fetch 취소.
  // mountedRef 갱신은 effect cleanup이라 set-state-in-effect와 무관.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      abortRef.current?.abort();
    };
  }, []);

  // Start recording (PTT press). 실제 시작 성공 여부를 반환(Important 2/Minor 8).
  const startRecording = useCallback(async (): Promise<boolean> => {
    if (state !== "idle") return false;
    // in-flight 잠금 — 같은 렌더의 stale closure로도 중복 getUserMedia를 못 막는
    // state 가드를 ref로 보완(Important 2). 시작 실패·정지·취소에서 해제.
    if (busyRef.current) return false;
    busyRef.current = true;

    let stream: MediaStream | null = null;
    try {
      // Request microphone permission
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // Disable auto gain to prevent system sound amplification
          sampleRate: 44100,
        },
      });

      // getUserMedia 대기 중 언마운트(예: 언어 전환)되면 cleanup은 이미 지나간
      // 뒤라, 여기서 직접 트랙을 멈추지 않으면 마이크 스트림이 샌다(codex 잔여 #2).
      // setState/recorder 셋업도 하지 않고 즉시 중단한다.
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        busyRef.current = false;
        return false;
      }
      streamRef.current = stream;

      // Determine the best available MIME type
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/mp4";
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Collect audio chunks
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      // Start recording
      mediaRecorder.start(100); // Collect chunks every 100ms
      setState("recording");
      startTimeRef.current = Date.now();
      setDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - startTimeRef.current;
        setDuration(Math.floor(elapsedMs / 1000));

        // Auto-stop if max duration reached
        if (elapsedMs >= maxDuration * 1000) {
          void stopRecordingRef.current();
        }
      }, 100);
      return true;
    } catch (err) {
      console.error("Failed to start recording:", err);
      // 스트림을 확보한 뒤 MediaRecorder 생성/시작이 실패해도 트랙을 반드시
      // 정리한다 — 안 하면 마이크가 켜진 채 샌다(codex 잔여 #2). getUserMedia
      // 자체가 실패한 경우 stream은 null이라 무해.
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      // 시작 실패 — 잠금 해제하고 onError 코드 통지(마운트 가드).
      busyRef.current = false;
      if (mountedRef.current) {
        onError?.(
          err instanceof Error && err.name === "NotAllowedError"
            ? "mic_denied"
            : "mic_failed",
        );
      }
      return false;
    }
  }, [state, maxDuration, onError]);

  // Stop recording and transcribe (PTT release)
  const stopRecording = useCallback(async () => {
    if (state !== "recording" || !mediaRecorderRef.current) return;

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setState("processing");

    // 정지 시점의 실제 경과 ms — floored `duration` state는 표시용이라 0.3~0.99초
    // 발화를 0으로 오거부했다(Important 3). ms로 직접 판정한다.
    const elapsedMs = Date.now() - startTimeRef.current;

    // Stop media recorder
    return new Promise<void>((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        // 이벤트 핸들러 해제 — 정지 후 중복/지연 발화 방지(Important 4).
        mediaRecorder.onstop = null;
        mediaRecorder.ondataavailable = null;

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        // Check if we have audio data
        if (chunksRef.current.length === 0) {
          busyRef.current = false;
          if (mountedRef.current) {
            onError?.("no_audio");
            setState("idle");
          }
          resolve();
          return;
        }

        // Create blob from chunks
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType,
        });

        // Check minimum duration (at least 0.3 seconds, ms 기준).
        if (elapsedMs < 300) {
          busyRef.current = false;
          if (mountedRef.current) {
            onError?.("too_short");
            setState("idle");
            setDuration(0);
          }
          resolve();
          return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        try {
          // Send to STT API
          const formData = new FormData();
          formData.append("audio", blob);
          if (locale) {
            formData.append("locale", locale);
          }

          const response = await fetch("/api/speech-to-text", {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });

          // 언마운트(예: 언어 전환) 후엔 setState·콜백 발화 금지(Important 4).
          if (!mountedRef.current) return;

          if (!response.ok) {
            // 서버의 한국어 data.error 텍스트는 무시하고 HTTP status로 코드 결정
            // (en 사용자가 영어 TTS로 한국어를 듣는 결함 차단).
            onError?.(response.status === 422 ? "no_text" : "stt_failed");
            return;
          }

          const data = await response.json();
          if (!mountedRef.current) return;
          if (data.text) {
            onTranscribed?.(data.text);
          } else {
            onError?.("no_text");
          }
        } catch (err) {
          // abort는 정상 취소이므로 오류로 통지하지 않는다.
          if (err instanceof Error && err.name === "AbortError") return;
          console.error("STT error:", err);
          if (mountedRef.current) onError?.("stt_failed");
        } finally {
          abortRef.current = null;
          busyRef.current = false;
          if (mountedRef.current) {
            setState("idle");
            setDuration(0);
          }
          resolve();
        }
      };

      mediaRecorder.stop();
    });
  }, [state, locale, onTranscribed, onError]);

  // 타이머 콜백이 ref로 호출하는 stopRecording을 항상 최신 버전으로 유지.
  // ref 대입만 하므로 setState 없음(cascading render 무관).
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // Cancel recording without transcribing
  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && state === "recording") {
      // 정지 전 핸들러 해제 — 취소인데 onstop이 STT를 태우지 않게.
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // 진행 중 STT fetch 취소 + in-flight 잠금 해제(Important 2/4).
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;

    chunksRef.current = [];
    setState("idle");
    setDuration(0);
  }, [state]);

  return {
    state,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    isSupported,
  };
}
