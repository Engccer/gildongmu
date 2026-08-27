/**
 * 도구층 DOM 보조(spec §3.3·§3.7). 모든 함수는 `document`가 있는 런타임에서만 부른다.
 */
import { accessibleName } from "./accessible-name";
import { FOCUS_TARGET_ATTR, parseTargetId } from "./targets";

/**
 * 선택자에 맞는 요소가 나타날 때까지 기다린다(최대 `timeoutMs`). 이미 있으면 즉시.
 * `signal`이 끊기면 `"aborted"`, `stale()`이 참이 되면 `"superseded"`(대기 중 세대가 바뀜).
 */
export function waitForElement(
  selector: string,
  opts: { timeoutMs: number; signal?: AbortSignal; stale?: () => boolean },
): Promise<HTMLElement | null | "aborted" | "superseded"> {
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);
  if (opts.signal?.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: HTMLElement | null | "aborted" | "superseded") => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const check = () => {
      if (opts.stale?.()) {
        finish("superseded");
        return;
      }
      const el = document.querySelector<HTMLElement>(selector);
      if (el) finish(el);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(opts.stale?.() ? "superseded" : null), opts.timeoutMs);
    const onAbort = () => finish("aborted");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    // 관찰자 등록과 첫 검사 사이의 틈을 메운다.
    check();
  });
}

/** 화면의 착지 대상 목록(고수준만 — 스텝·leg는 페이지 도구가 준다, spec §3.2). */
export function listHighLevelTargets(doc: Document = document): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const nodes = doc.querySelectorAll<HTMLElement>(`[${FOCUS_TARGET_ATTR}]`);
  for (const el of Array.from(nodes)) {
    const id = el.getAttribute(FOCUS_TARGET_ATTR) ?? "";
    const parsed = parseTargetId(id);
    if (!parsed) continue;
    if (parsed.kind === "transitLeg" || parsed.kind === "step") continue;
    out.push({ id, label: accessibleName(el) ?? "" });
  }
  return out;
}

/** 현재 포커스 요소의 착지 ID(있으면). */
export function activeTargetId(doc: Document = document): string | null {
  const active = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) return null;
  const id = active.getAttribute(FOCUS_TARGET_ATTR);
  return id && parseTargetId(id) ? id : null;
}

/** 시작 시각 기준 쿨다운(spec §3.4·§3.10 — 성공·실패 무관). */
export function makeCooldown(intervalMs: number) {
  let lastStartedAt: number | null = null;
  return {
    /** 남은 대기(ms). 0이면 진행 가능. */
    remaining(now: number): number {
      if (lastStartedAt === null) return 0;
      return Math.max(0, intervalMs - (now - lastStartedAt));
    },
    mark(now: number) {
      lastStartedAt = now;
    },
  };
}

/** signal을 존중하는 sleep — abort 시 즉시 resolve(false). */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
