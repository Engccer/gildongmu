"use client";

import { useTranslations } from "next-intl";
import type { WebSearchResult } from "@/lib/types";

/**
 * 웹 검색 결과 카드 — search_web(Perplexity) 결과. 채팅 답변과 검색창 라우터가 공유한다.
 *
 * 시각장애 사용자가 출처를 직접 클릭해 검증할 수 있게 각 결과를 제목 링크로 노출한다
 * (산문 인용만으로는 검증 불가 — "정보의 정본은 리스트/텍스트 UI"). 결과 링크는
 * 회전자 link 점프로 발견되고, h3 헤딩이 카드 진입점이다(미니멀: 과잉 region 없음).
 *
 * showHeading: 채팅에선 "참고한 웹 결과" 내부 헤딩을 그대로 두지만(기본 true),
 * 검색창에선 PlaceSearch가 섹션 구분 헤딩을 별도로 그리므로 false로 끈다(이중 헤딩 방지).
 */
export function WebResults({
  results,
  showHeading = true,
}: {
  results: WebSearchResult[];
  showHeading?: boolean;
}) {
  const t = useTranslations("chat");
  if (results.length === 0) return null;
  return (
    <div className="mt-2">
      {showHeading && (
        <h3 className="text-sm font-medium">{t("webResults.heading")}</h3>
      )}
      <ul className="mt-1 space-y-2">
        {results.map((r, i) => (
          <li key={`${i}-${r.url}`}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent underline"
            >
              {/* 빈 제목이면 URL을 링크 이름으로 — 이름 없는 링크(접근성 결함) 방지 */}
              {r.title || r.url}
            </a>
            {r.snippet && <p className="text-xs text-muted">{r.snippet}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
