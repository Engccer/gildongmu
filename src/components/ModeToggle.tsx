"use client";
import { useTranslations } from "next-intl";
import { MessageSquare, Search } from "lucide-react";
import type { AppMode } from "@/lib/chat/mode-state";
import { appendShortcutHint, CHAT_SHORTCUT_KEYS } from "@/lib/chat/keyboard-shortcuts";

/**
 * 채팅 ↔ 검색 모드 전환 버튼.
 *
 * - mode: 현재 모드
 * - onChange: 새 모드를 전달하는 콜백
 *
 * 접근성:
 * - aria-label에 단축키 힌트 포함(VoiceOver 친화 방식 — aria-keyshortcuts 미사용)
 * - disabled 속성 미사용(스크린 리더 포커스 보존 — aria-disabled 패턴)
 * - 아이콘은 aria-hidden(시각 장식)
 * - UI 라벨 이모지 금지 원칙 준수 → lucide 아이콘만
 */
export function ModeToggle({
  mode,
  onChange,
}: {
  mode: AppMode;
  onChange: (m: AppMode) => void;
}) {
  const t = useTranslations("chat");
  // 버튼이 누를 때마다 반대 모드로 전환 → 라벨도 목적지 모드 기준
  const next: AppMode = mode === "search" ? "chat" : "search";
  const label = next === "chat" ? t("switchToChat") : t("switchToSearch");
  const hint =
    next === "chat" ? CHAT_SHORTCUT_KEYS.chatMode : CHAT_SHORTCUT_KEYS.searchMode;

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={appendShortcutHint(label, hint)}
      className="inline-flex items-center gap-2 min-h-11 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
    >
      {next === "chat" ? (
        <MessageSquare aria-hidden={true} className="h-4 w-4" />
      ) : (
        <Search aria-hidden={true} className="h-4 w-4" />
      )}
      <span>{label}</span>
    </button>
  );
}
