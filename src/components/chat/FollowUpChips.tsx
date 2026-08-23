"use client";

import { useTranslations } from "next-intl";

interface Props {
  chips: string[];
  onSelect: (chip: string) => void;
  disabled: boolean;
}

/**
 * 답변 뒤 follow-up 질문 칩 — 버튼 텍스트가 곧 질문이고 그룹 라벨이 역할을 말한다(아이콘 없음).
 *
 * 접근성:
 * - `disabled` 대신 `aria-disabled` + 핸들러 가드 — disabled는 포커스를 body로 떨군다.
 * - 칩 도착은 통지하지 않는다(목록 끝에 조용히 생기는 보조 컨트롤).
 * - 선택 시 포커스 선점(보내기 버튼)은 부모가 맡는다 — 칩은 전송으로 사라진다.
 */
export function FollowUpChips({ chips, onSelect, disabled }: Props) {
  const t = useTranslations("chat");
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label={t("followUpGroupLabel")} className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onSelect(chip);
          }}
          className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-left text-sm hover:bg-accent/10 aria-disabled:opacity-50"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
