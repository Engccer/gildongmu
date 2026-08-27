"use client";

import { useEffect, useRef } from "react";
import { anySignal, modelContext, type WebMcpTool } from "@/lib/webmcp/types";

/**
 * WebMCP 도구 등록 훅(spec §5.1·§8.2).
 *
 * 계약 셋:
 * - **마운트 1회 등록, 재등록 0.** `tools`는 첫 실행에서 만든 목록을 고정한다. 상태는
 *   `execute`가 ref로 읽는다(로케일 전환·타이핑·폴링·포커스 이동 어느 것도 목록을 흔들지
 *   않는다). `enabled`가 false→true로 바뀌면 그때 등록하고, true→false면 abort한다.
 * - **AbortController 하나 = 등록 집합 하나.** 언마운트·비활성은 `abort()`가 해제다.
 *   `abortNow()`를 돌려주는 이유는 뷰 전환 커밋 **직전**에 호출자가 먼저 해제할 수
 *   있게 하기 위함이다(홈 `open_directions` ↔ 길찾기 뷰 9개가 겹치는 창 차단, spec §3.1).
 * - **런타임 부재는 침묵.** `document.modelContext`가 없으면 아무것도 하지 않는다(경고
 *   로그 없음 — 대부분의 사용자가 이 경로다).
 *
 * 실행 signal: 호스트가 `{ signal }`을 주면 등록 signal과 합쳐 `execute`에 넘긴다(언마운트가
 * 진행 중 대기자를 끝내는 길). 호스트가 주지 않아도 등록 signal은 항상 실린다.
 */
export function useWebMcpTools(
  build: () => WebMcpTool[],
  options: {
    enabled: boolean;
    /** 등록 호출이 throw했을 때(호스트 거부). 프로브 페이지만 화면에 낸다 — 기본은 침묵. */
    onRegisterError?: () => void;
  },
): { abortNow: () => void } {
  const buildRef = useRef(build);
  const onErrorRef = useRef(options.onRegisterError);
  const controllerRef = useRef<AbortController | null>(null);
  const { enabled } = options;

  useEffect(() => {
    buildRef.current = build;
    onErrorRef.current = options.onRegisterError;
  });

  useEffect(() => {
    if (!enabled) return;
    const context = modelContext();
    if (!context) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const tools = buildRef.current().map((tool) => wrapExecute(tool, controller.signal));
    void (async () => {
      try {
        for (const tool of tools) {
          if (controller.signal.aborted) return;
          await context.registerTool(tool, { signal: controller.signal });
        }
      } catch {
        // 등록 실패는 호스트 문제다 — 기본은 침묵(프로브 페이지만 지원 여부를 표시한다).
        if (!controller.signal.aborted) {
          controller.abort();
          onErrorRef.current?.();
        }
      }
    })();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [enabled]);

  return {
    abortNow: () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
  };
}

/** 호스트 signal + 등록 signal 합성(spec §3.0). 도구는 합성된 signal 하나만 본다. */
function wrapExecute(tool: WebMcpTool, registration: AbortSignal): WebMcpTool {
  return {
    ...tool,
    execute: (input, context) =>
      tool.execute(input, { signal: anySignal([registration, context?.signal]) }),
  };
}
