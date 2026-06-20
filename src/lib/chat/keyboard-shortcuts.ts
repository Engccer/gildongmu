/**
 * 채팅/검색 모드 전환 키보드 단축키 — macOS/Windows 공통 (Ctrl+Shift 기반).
 *
 * 키 판정은 deterministic 도메인 규칙이므로 순수 함수로 분리해 테스트로 고정한다.
 * `event.code`(물리 키 위치)를 사용해 키보드 레이아웃·IME 상태와 무관하게 동작한다.
 *
 * 사용자가 macOS에서도 Cmd가 아닌 Ctrl을 쓰도록 명시 요청 → metaKey가 아닌 ctrlKey로 판정한다.
 */
export type ChatShortcutAction = "chat-mode" | "search-mode" | "focus-input";

/** 단축키 표기 (WAI-ARIA 키 이름 규약). 접근성 이름에 합쳐 스크린리더로 안내한다. */
export const CHAT_SHORTCUT_KEYS = {
  chatMode: "Control+Shift+C",
  searchMode: "Control+Shift+S",
  focusInput: "Shift+Escape",
} as const;

/**
 * 단축키 표기를 접근성 이름(aria-label) 끝에 합친다.
 *
 * DOMAIN RULE: 단축키는 `aria-keyshortcuts`가 아니라 aria-label에 합쳐 안내한다.
 * `aria-keyshortcuts`를 쓰면 VoiceOver가 "Shortcuts available, …"라는 지역화 접두사를
 * 강제로 덧붙여 읽어, 단축키 확인을 오히려 방해한다. 라벨에 직접 합치면 접두사
 * 없이 키만 읽힌다. `+`는 공백으로 치환해 VO가 "plus"로 읽지 않게 한다.
 *
 * shortcut이 없으면 라벨을 그대로 반환해 거짓 안내를 막는다.
 */
export function appendShortcutHint(label: string, shortcut?: string): string {
  if (!shortcut) return label;
  return `${label}, ${shortcut.replace(/\+/g, " ")}`;
}

interface ShortcutEventLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 키보드 이벤트를 채팅/검색 단축키 액션으로 매핑한다. 매칭이 없으면 null.
 * 호출 측은 null이 아닐 때만 preventDefault + 액션을 실행한다.
 */
export function matchChatShortcut(e: ShortcutEventLike): ChatShortcutAction | null {
  // Shift+Esc — 입력창 포커스 (Ctrl 없이, 다른 modifier 없이)
  if (e.code === "Escape" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return "focus-input";
  }

  // Ctrl+Shift+<Key> — Alt/Meta가 섞이면 다른 단축키이므로 제외
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    switch (e.code) {
      case "KeyC":
        return "chat-mode";
      case "KeyS":
        return "search-mode";
    }
  }

  return null;
}
