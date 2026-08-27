/**
 * 도구층 단일 실행 잠금 + operation 토큰(spec §3.0). 화면을 옮기는 도구는 한 번에 하나다 —
 * 두 도구가 서로 다른 화면으로 끌고 가는 경합을 구조적으로 없앤다. `op`는 전체 상한을 가지며
 * 만료·release된 op의 늦은 완료는 도구 결과에 반영되지 않는다(호출자가 `isLive()`를 본다).
 */
import { anySignal } from "./types";

/** 한 op의 전체 상한. 지나면 op.signal을 끊고 잠금을 푼다. */
export const OP_TIMEOUT_MS = 30_000;

export interface Op {
  readonly id: number;
  readonly name: string;
  /** 자체 상한 + 호스트 signal을 합친 것. fetch 등에 그대로 넘긴다. */
  readonly signal: AbortSignal;
  readonly startedAt: number;
  /** 아직 잠금을 쥔 살아 있는 op인가. 늦은 완료를 무시하는 근거다. */
  isLive(): boolean;
}

let current: {
  op: Op;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let seq = 0;

/** 잠금 획득. 이미 실행 중이면 `{ busy: 실행 중인 도구 이름 }`. */
export function acquireOp(
  name: string,
  hostSignal: AbortSignal | undefined,
  now: number = Date.now(),
): Op | { busy: string } {
  if (current) return { busy: current.op.name };
  const controller = new AbortController();
  const id = ++seq;
  const op: Op = {
    id,
    name,
    startedAt: now,
    signal: anySignal([controller.signal, hostSignal]),
    isLive: () =>
      current?.op.id === id && !controller.signal.aborted && !(hostSignal?.aborted ?? false),
  };
  // 상한 만료: signal을 끊고 잠금을 푼다 — 이후 runningToolName()은 null.
  const timer = setTimeout(() => {
    controller.abort(new Error("timeout"));
    releaseOp(op);
  }, OP_TIMEOUT_MS);
  // 호스트가 끊으면 잠금도 함께 푼다(끊긴 op가 잠금을 영영 쥐지 않도록).
  hostSignal?.addEventListener("abort", () => releaseOp(op), { once: true });
  current = { op, controller, timer };
  return op;
}

/** 잠금 해제. 현재 op가 아니면(이미 만료·교체됨) 무시한다. */
export function releaseOp(op: Op): void {
  if (current?.op.id !== op.id) return;
  clearTimeout(current.timer);
  current = null;
}

export function runningToolName(): string | null {
  return current?.op.name ?? null;
}

export function __resetToolLockForTest(): void {
  if (current) clearTimeout(current.timer);
  current = null;
  seq = 0;
}
