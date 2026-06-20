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
