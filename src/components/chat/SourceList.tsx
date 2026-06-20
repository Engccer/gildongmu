"use client";
import { useTranslations } from "next-intl";
import type { SourceAttribution } from "@/lib/chat/types";

/**
 * 응답 하단 출처 푸터.
 * label은 i18n 키(chat.<label>). url 있으면 링크.
 * 미니멀: 작은 텍스트 헤딩 + 목록(과잉 ARIA·region 없음).
 */
export function SourceList({ sources }: { sources?: SourceAttribution[] }) {
  const t = useTranslations("chat");
  if (!sources || sources.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-muted">
      <span className="font-medium">{t("sources")}</span>{" "}
      {sources.map((s, i) => (
        <span key={s.label}>
          {i > 0 && <span aria-hidden="true">, </span>}
          {s.url ? (
            <a href={s.url} className="underline" target="_blank" rel="noreferrer">
              {t(s.label)}
            </a>
          ) : (
            <span>{t(s.label)}</span>
          )}
        </span>
      ))}
    </p>
  );
}
