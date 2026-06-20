// 검색/채팅 모드 상태 (React 비의존)
export type AppMode = "search" | "chat";
export const STORAGE_KEY = "gildongmu:mode";

/**
 * URL 쿼리에서 모드 파라미터 추출.
 * ?mode=chat → "chat", ?mode=search → "search", 그 외 → null
 */
export function parseModeFromUrl(search: string): AppMode | null {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  return mode === "chat" ? "chat" : mode === "search" ? "search" : null;
}

/**
 * 현재 URL 쿼리에서 모드 파라미터 갱신.
 * chat 모드면 ?mode=chat 추가, search 모드면 ?mode 제거.
 * 기존 파라미터(q 등) 보존.
 */
export function modeToUrl(currentSearch: string, mode: AppMode): string {
  const params = new URLSearchParams(currentSearch);
  if (mode === "chat") {
    params.set("mode", "chat");
  } else {
    params.delete("mode");
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

// ── 공유 모드 스토어 (useSyncExternalStore용 — geolocation.ts 동형) ──
// SSR 안전: 서버 스냅샷은 "search" 고정, 클라 마운트 후 URL·localStorage에서 1회
// 읽어 재조정한다(과거 mount useEffect의 setMode = set-state-in-effect 이중 렌더
// 안티패턴 제거). 모드는 setAppMode(changeMode 경유)로만 바뀌므로 스냅샷을 캐시한다.
let appMode: AppMode | null = null;
const modeListeners = new Set<() => void>();

function readModeFromEnv(): AppMode {
  const fromUrl = parseModeFromUrl(window.location.search);
  const fromStorage =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) as AppMode | null)
      : null;
  return fromUrl ?? fromStorage ?? "search";
}

export function subscribeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function getModeSnapshot(): AppMode {
  if (appMode === null) appMode = readModeFromEnv();
  return appMode;
}

export function getModeServerSnapshot(): AppMode {
  return "search";
}

/** 모드를 전환하고 URL(?mode)·localStorage를 동기 갱신한 뒤 구독자에게 통지한다. */
export function setAppMode(mode: AppMode): void {
  appMode = mode;
  const newSearch = modeToUrl(window.location.search, mode);
  window.history.replaceState(
    window.history.state,
    "",
    newSearch || window.location.pathname,
  );
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  for (const l of modeListeners) l();
}

/** 테스트 전용 — 모듈 모드 캐시·구독자 초기화(세션 간 누수 방지). */
export function __resetAppModeForTest(): void {
  appMode = null;
  modeListeners.clear();
}
