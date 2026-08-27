/**
 * 도구 공용 — 단일 잠금(`withOp`)과 화면 이동 계약(`ensure*`, spec §3.0).
 *
 * 도구는 브릿지를 인자로 받지 않는다. 실행 시점에 뷰 레지스트리를 읽고, 필요 화면·정체성이
 * 아니면 루트가 게시한 `navigator`를 `op`와 함께 불러 **정체성 일치 게시**를 기다린다
 * (`waitForView`). 이동 중엔 `markChanging(op)`가 걸려 `read_current_view`가 `viewChanging`을 낸다.
 * 모달(채팅·현재 위치 지정)이 열려 있으면 화면을 옮기지 않고 `modalOpen`으로 거절한다.
 */
import type { Place } from "@/lib/types";
import { acquireOp, releaseOp, type Op } from "../tool-lock";
import { failure, type ToolFailure } from "../types";
import {
  bridgeOf,
  currentSeq,
  currentView,
  markChanging,
  navigator,
  waitForView,
} from "../view-registry";
import type { DirectionsBridge, HomeBridge, PlaceBridge } from "./context";

/** 화면 이동 단계 상한(spec §3.0 — 전체 상한은 op의 30초). */
export const VIEW_CHANGE_TIMEOUT_MS = 2_000;

/** 잠금 획득 → 본문 → `finally` 해제. 잠겨 있으면 `onBusy(실행 중 도구 이름)`. */
export async function withOp<T>(
  name: string,
  hostSignal: AbortSignal | undefined,
  body: (op: Op) => Promise<T>,
  onBusy: (running: string) => T,
): Promise<T> {
  const op = acquireOp(name, hostSignal);
  if ("busy" in op) return onBusy(op.busy);
  try {
    return await body(op);
  } finally {
    releaseOp(op);
  }
}

export function isFailure(value: unknown): value is ToolFailure {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

function abortDetail(op: Op): "timeout" | "signal" {
  return op.signal.reason instanceof Error && op.signal.reason.message === "timeout" ? "timeout" : "signal";
}

/** `waitForView`의 예외를 사유 코드로. */
function mapWaitError(e: unknown, op: Op): ToolFailure {
  const message = e instanceof Error ? e.message : "";
  if (message === "aborted") return failure("aborted", { detail: abortDetail(op) });
  return failure("viewChanging");
}

function modalGuard(): ToolFailure | null {
  const nav = navigator();
  if (!nav) return failure("unsupported", { detail: "noNavigator" });
  if (nav.isModalOpen()) return failure("modalOpen");
  return null;
}

/**
 * 이동을 감싸는 공통 골격: 이미 일치 게시면 이동하지 않는다. 이동 중엔 changing 표시.
 * `after`는 이동 시작 시점 순번 — 그 뒤 게시만 일치다(publishedAfter).
 */
async function navigateAndWait<B>(
  op: Op,
  view: "home" | "directions" | "place",
  match: { placeId?: string; publishedAfter?: number },
  go: () => Promise<void> | void,
): Promise<B | ToolFailure> {
  const guard = modalGuard();
  if (guard) return guard;
  markChanging(op);
  try {
    await go();
    return await waitForView<B>(view, match, op, VIEW_CHANGE_TIMEOUT_MS);
  } catch (e) {
    return mapWaitError(e, op);
  } finally {
    markChanging(null);
  }
}

/**
 * 홈으로. 홈 브릿지는 상시 게시라 "홈이 보이는가"는 `currentView()`(길찾기 > 내 주변 > 상세 > 홈)로
 * 판정하고, 이동은 `toHome`의 유한 언와인드가 끝나는 것이 곧 도착이다(재게시를 기다리지 않는다).
 */
export async function ensureHome(op: Op): Promise<HomeBridge | ToolFailure> {
  const home = bridgeOf<HomeBridge>("home");
  if (!home) return failure("unsupported", { detail: "noHomeView" });
  if (currentView() === "home") return home.bridge;
  const guard = modalGuard();
  if (guard) return guard;
  markChanging(op);
  try {
    await navigator()!.toHome(op);
    return home.bridge;
  } catch (e) {
    return mapWaitError(e, op);
  } finally {
    markChanging(null);
  }
}

/** 같은 `place.id`의 상세가 게시돼 있으면 이동 없음, 아니면 `toPlace` 뒤 그 id 게시를 기다린다. */
export async function ensurePlace(place: Place, op: Op): Promise<PlaceBridge | ToolFailure> {
  const now = bridgeOf<PlaceBridge>("place");
  if (now && now.identity === place.id) return now.bridge;
  return navigateAndWait<PlaceBridge>(op, "place", { placeId: place.id }, () => {
    navigator()!.toPlace(place, op);
  });
}

/** 길찾기 뷰가 게시돼 있으면 그대로, 아니면 `toDirections` 뒤 **이동 시작 이후 게시**를 기다린다. */
export async function ensureDirections(op: Op): Promise<DirectionsBridge | ToolFailure> {
  const now = bridgeOf<DirectionsBridge>("directions");
  if (now) return now.bridge;
  const after = currentSeq();
  return navigateAndWait<DirectionsBridge>(op, "directions", { publishedAfter: after }, () => {
    navigator()!.toDirections(op);
  });
}

/**
 * 주소 `ref`처럼 열릴 상세의 `place.id`를 도구가 미리 모를 때 — `open`이 화면 경로로 상세를 열면
 * **이동 시작 이후 게시된** 상세를 기다린다. `open`이 실패를 돌려주면 그대로 낸다.
 */
export async function ensureOpenedPlace(
  op: Op,
  open: () => Promise<ToolFailure | null>,
): Promise<PlaceBridge | ToolFailure> {
  const guard = modalGuard();
  if (guard) return guard;
  const after = currentSeq();
  markChanging(op);
  try {
    const failed = await open();
    if (failed) return failed;
    return await waitForView<PlaceBridge>("place", { publishedAfter: after }, op, VIEW_CHANGE_TIMEOUT_MS);
  } catch (e) {
    return mapWaitError(e, op);
  } finally {
    markChanging(null);
  }
}
