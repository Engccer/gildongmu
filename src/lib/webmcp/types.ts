/**
 * WebMCP 도구층 공용 타입(spec `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md`).
 *
 * React/Next 비의존 — `document.modelContext`(W3C WebMCP 제안, Chrome origin trial)에
 * 직접 등록한다. `usewebmcp` 같은 래퍼를 쓰지 않는 이유는 spec §8.1(재등록 0·경고 로그 0·
 * 출력은 문자열 하나).
 */

/** WebMCP `registerTool`에 넘기는 도구 정의(브라우저 제안 규격의 필요 부분만). */
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  /**
   * 실행. 출력은 **JSON 문자열 하나**다(spec §8.1 — MCP-B식 `structuredContent` 정규화를
   * 쓰지 않는다). `signal`은 호스트가 주지 않을 수도 있다 — 훅이 자체 컨트롤러와 합친다.
   */
  execute: (
    input: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<string> | string;
}

export interface ModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void> | void;
}

/** `document.modelContext` 탐지. 없으면 null — 대부분의 브라우저가 이 경로다(조용히). */
export function modelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const candidate = (document as Document & { modelContext?: unknown }).modelContext;
  if (!candidate || typeof (candidate as { registerTool?: unknown }).registerTool !== "function") {
    return null;
  }
  return candidate as ModelContext;
}

/**
 * 도구 공통 실패 사유(spec §3.0 표). 새 코드는 여기 등록한다 — 사유 문자열이 곧
 * 에이전트의 재시도 판단 재료라 자유 문자열을 두지 않는다.
 */
export type ToolReason =
  | "noResult"
  | "stalePlan"
  | "busy"
  | "superseded"
  | "toNotFound"
  | "fromNotFound"
  | "viaNotFound"
  | "needsDisambiguation"
  | "geoDenied"
  | "geoUnavailable"
  | "geoTimeout"
  | "outOfCoverage"
  | "unknownRouteKey"
  | "notStartable"
  | "sessionActive"
  | "noSession"
  | "confirmationRequired"
  | "notFound"
  | "focusRejected"
  | "editingInProgress"
  | "cooldown"
  | "aborted"
  | "unsupported";

/** 사유별 `retryable`·`userActionRequired`(spec §3.0 표의 두 열). */
const REASON_FLAGS: Record<ToolReason, { retryable: boolean; userActionRequired: boolean }> = {
  noResult: { retryable: true, userActionRequired: false },
  stalePlan: { retryable: true, userActionRequired: false },
  busy: { retryable: true, userActionRequired: false },
  superseded: { retryable: true, userActionRequired: false },
  toNotFound: { retryable: false, userActionRequired: false },
  fromNotFound: { retryable: false, userActionRequired: false },
  viaNotFound: { retryable: false, userActionRequired: false },
  needsDisambiguation: { retryable: false, userActionRequired: false },
  geoDenied: { retryable: false, userActionRequired: true },
  geoUnavailable: { retryable: true, userActionRequired: false },
  geoTimeout: { retryable: true, userActionRequired: false },
  outOfCoverage: { retryable: false, userActionRequired: false },
  unknownRouteKey: { retryable: false, userActionRequired: false },
  notStartable: { retryable: false, userActionRequired: false },
  sessionActive: { retryable: false, userActionRequired: true },
  noSession: { retryable: false, userActionRequired: false },
  confirmationRequired: { retryable: false, userActionRequired: true },
  notFound: { retryable: false, userActionRequired: false },
  focusRejected: { retryable: false, userActionRequired: false },
  editingInProgress: { retryable: false, userActionRequired: true },
  cooldown: { retryable: true, userActionRequired: false },
  aborted: { retryable: false, userActionRequired: false },
  unsupported: { retryable: false, userActionRequired: false },
};

export interface ToolFailure {
  ok: false;
  reason: ToolReason;
  retryable: boolean;
  userActionRequired: boolean;
  [extra: string]: unknown;
}

/** 실패 출력 조립 — 사유 표의 두 플래그를 자동으로 싣는다. 부가 필드는 도구가 덧붙인다. */
export function failure(reason: ToolReason, extra?: Record<string, unknown>): ToolFailure {
  return { ok: false, reason, ...REASON_FLAGS[reason], ...(extra ?? {}) };
}

/**
 * 실행 signal 합성(spec §3.0): 호스트 signal(없을 수 있다)과 도구층 자체 signal을 하나로.
 * `AbortSignal.any`가 없는 런타임(구형 jsdom)은 수동 브리지로 폴백한다.
 */
export function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn(present);
  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
