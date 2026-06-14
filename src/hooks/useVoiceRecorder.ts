"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type RecordingState = "idle" | "recording" | "processing";

interface UseVoiceRecorderOptions {
  maxDuration?: number; // Maximum recording duration in seconds (default: 60)
  locale?: string; // UI locale hint for speech recognition (ko, en, es, fr)
  onTranscribed?: (text: string) => void; // Callback when transcription is complete
  onError?: (error: string) => void; // Callback on error
}

interface UseVoiceRecorderReturn {
  state: RecordingState;
  duration: number; // Current recording duration in seconds
  startRecording: () => Promise<void>;
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
  // 브라우저 지원 여부는 마운트 시 한 번만 평가하면 충분하므로 lazy initializer로
  // 계산한다 — effect 본문에서 setState를 호출하지 않아 set-state-in-effect
  // (cascading render) 경고를 정석으로 피한다(PlaceSearch의 ?q= 초기화와 동일 패턴).
  const [isSupported] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return false;
    const hasMediaDevices = !!navigator.mediaDevices?.getUserMedia;
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    return hasMediaDevices && hasMediaRecorder;
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  // startRecording의 타이머 콜백이 후순위로 선언되는 stopRecording을 호출해야 해
  // 순환 참조가 생긴다. 직접 참조(=선언 전 접근)는 React Compiler 규칙
  // (immutability/preserve-manual-memoization)을 깨므로, ref로 최신 stopRecording을
  // 가리켜 콜백이 항상 현재 버전을 호출하도록 우회한다(동작 동일, 정석 패턴).
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Start recording (PTT press)
  const startRecording = useCallback(async () => {
    if (state !== "idle") return;

    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // Disable auto gain to prevent system sound amplification
          sampleRate: 44100,
        },
      });
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
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDuration(elapsed);

        // Auto-stop if max duration reached
        if (elapsed >= maxDuration) {
          void stopRecordingRef.current();
        }
      }, 100);
    } catch (err) {
      console.error("Failed to start recording:", err);
      const errorMessage =
        err instanceof Error && err.name === "NotAllowedError"
          ? "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해주세요."
          : "마이크를 시작할 수 없습니다.";
      onError?.(errorMessage);
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

    // Stop media recorder
    return new Promise<void>((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        // Check if we have audio data
        if (chunksRef.current.length === 0) {
          onError?.("녹음된 오디오가 없습니다.");
          setState("idle");
          resolve();
          return;
        }

        // Create blob from chunks
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType,
        });

        // Check minimum duration (at least 0.3 seconds)
        if (duration < 0.3) {
          onError?.("녹음이 너무 짧습니다. 좀 더 길게 말씀해주세요.");
          setState("idle");
          setDuration(0);
          resolve();
          return;
        }

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
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "음성 인식에 실패했습니다.");
          }

          if (data.text) {
            onTranscribed?.(data.text);
          } else {
            onError?.("인식된 텍스트가 없습니다. 다시 시도해주세요.");
          }
        } catch (err) {
          console.error("STT error:", err);
          onError?.(
            err instanceof Error ? err.message : "음성 인식에 실패했습니다."
          );
        } finally {
          setState("idle");
          setDuration(0);
          resolve();
        }
      };

      mediaRecorder.stop();
    });
  }, [state, duration, locale, onTranscribed, onError]);

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
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

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
