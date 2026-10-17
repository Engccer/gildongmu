"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { SourceAttribution } from "@/lib/chat/types";

/**
 * 응답 하단 출처 푸터.
 * label은 i18n 키(chat.<label>). url 있으면 링크.
 * 한 줄 = 한 접근성 객체(A63): 링크 사이의 글자(머리말·쉼표·링크 없는 출처)는 문자열 하나로 모아
 * 텍스트 노드 하나로 둔다. 쉼표를 숨긴 span이나 출처별 노드로 두면 줄 가운데서 객체가 갈린다.
 */
export function SourceList({ sources }: { sources?: SourceAttribution[] }) {
  const t = useTranslations("chat");
  if (!sources || sources.length === 0) return null;
  const nodes: ReactNode[] = [];
  let text = `${t("sources")} `;
  sources.forEach((s, i) => {
    if (i > 0) text += ", ";
    if (!s.url) {
      text += t(s.label);
      return;
    }
    nodes.push(text);
    text = "";
    nodes.push(
      <a key={s.label} href={s.url} className="underline" target="_blank" rel="noreferrer">
        {t(s.label)}
      </a>,
    );
  });
  if (text) nodes.push(text);
  return <p className="mt-2 text-xs text-muted">{nodes}</p>;
}
