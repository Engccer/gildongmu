/**
 * 뷰 레지스트리(spec §5.2) — 어느 화면이 어떤 정체성으로 지금 브릿지를 게시했는가. React 비의존.
 * 등록 교체가 없으므로 viewEpoch·ready는 없다. 이동 뒤 대기는 뷰 이름이 아니라 정체성(placeId·
 * 게시 순번)에 결박한다 — 장소 A 게시 중 B 요청이 조기 성공하지 않게(리뷰 #1).
 */
import type { Place } from "@/lib/types";
import type { Op } from "./tool-lock";

export type ViewName = "home" | "directions" | "place" | "nearby";

/** 화면이 구현해 등록하는 이동 수단. 도구층은 이 계약만 부른다. */
export interface Navigator {
  /** 유한 루프 언와인드(§3.2) — 열린 화면을 닫아 홈으로 되돌린다. */
  toHome(op: Op): Promise<void>;
  /** openDirections(null) */
  toDirections(op: Op): void;
  /** requestOpenPlace */
  toPlace(place: Place, op: Op): void;
  isModalOpen(): boolean;
}

interface Entry {
  bridge: unknown;
  identity?: string;
  seq: number;
}

const entries = new Map<ViewName, Entry>();
const listeners = new Set<() => void>();
let seq = 0;
let nearbyOpen = false;
let nav: Navigator | null = null;
let changing: Op | null = null;
/** 겹쳐 열릴 때 "현재 화면"으로 치는 우선순위(위에 뜬 것부터). */
const PRIORITY: ViewName[] = ["directions", "nearby", "place", "home"];

function notify(): void {
  for (const l of listeners) l();
}

/** 게시. 같은 뷰의 옛 항목은 덮이고 순번이 오른다. */
export function publishView<B>(view: ViewName, bridge: B, identity?: string): void {
  entries.set(view, { bridge, identity, seq: ++seq });
  notify();
}

/** 철회. 정체성 가드 — 게시된 브릿지가 그 객체일 때만 지운다(옛 브릿지의 늦은 철회가 새 게시를 못 지운다). */
export function withdrawView(view: ViewName, bridge: unknown): void {
  if (entries.get(view)?.bridge === bridge) entries.delete(view);
  notify();
}

/** "내 주변" 허브는 브릿지 없이 열림 여부만 표시한다. */
export function markNearby(open: boolean): void {
  nearbyOpen = open;
  notify();
}

export function currentSeq(): number {
  return seq;
}

export function bridgeOf<B>(view: ViewName): { bridge: B; identity?: string; seq: number } | null {
  const e = entries.get(view);
  return e ? { bridge: e.bridge as B, identity: e.identity, seq: e.seq } : null;
}

/** 도구가 이동 중이면 "changing", 아니면 우선순위상 맨 위 화면, 아무것도 없으면 null. */
export function currentView(): ViewName | "changing" | null {
  if (changing?.isLive()) return "changing";
  for (const v of PRIORITY) {
    if (v === "nearby" ? nearbyOpen : entries.has(v)) return v;
  }
  return null;
}

function matches(e: Entry | undefined, match: { placeId?: string; publishedAfter?: number }): boolean {
  if (!e) return false;
  if (match.placeId !== undefined && e.identity !== match.placeId) return false;
  if (match.publishedAfter !== undefined && e.seq <= match.publishedAfter) return false;
  return true;
}

/**
 * 정체성에 결박된 대기. 이미 일치하면 즉시, 아니면 게시 이벤트를 기다린다.
 * reject: 상한 초과 `Error("viewChanging")`, op 끊김 `Error("aborted")`.
 */
export function waitForView<B>(
  view: ViewName,
  match: { placeId?: string; publishedAfter?: number },
  op: Op,
  timeoutMs = 2_000,
): Promise<B> {
  const now = entries.get(view);
  if (matches(now, match)) return Promise.resolve(now!.bridge as B);
  return new Promise<B>((resolve, reject) => {
    const done = (fn: () => void) => {
      listeners.delete(check);
      clearTimeout(timer);
      op.signal.removeEventListener("abort", onAbort);
      fn();
    };
    const check = () => {
      const e = entries.get(view);
      if (matches(e, match)) done(() => resolve(e!.bridge as B));
    };
    const timer = setTimeout(() => done(() => reject(new Error("viewChanging"))), timeoutMs);
    const onAbort = () => done(() => reject(new Error("aborted")));
    op.signal.addEventListener("abort", onAbort, { once: true });
    listeners.add(check);
  });
}

export function setNavigator(n: Navigator | null): void {
  nav = n;
}

export function navigator(): Navigator | null {
  return nav;
}

/** 도구 이동 중 표시. null이면 해제. 만료·release된 op는 isLive()가 false라 자동 해제된다. */
export function markChanging(op: Op | null): void {
  changing = op;
}

export function __resetViewRegistryForTest(): void {
  entries.clear();
  listeners.clear();
  seq = 0;
  nearbyOpen = false;
  nav = null;
  changing = null;
}
