import type { ReactNode } from "react";

/**
 * 영문 이름 + 한글 괄호 병기(위원장 판정 4, E27 §3.6): 시각은 `Gangnam (강남)`, 접근 가능한 이름은
 * 영문뿐(괄호부 `lang="ko" aria-hidden`). 괄호 한글은 **시각 전용 정보**다 — SR 사용자에겐 들리지
 * 않으므로 오류 안전망으로 계산하지 않는다(설계 리뷰 #14).
 *
 * ⚠ E28(`bilingual-name.ts`·`BilingualName`)이 같은 계약의 정본을 만든다 — 통합 시 그것이 main에
 *   있으면 이 컴포넌트를 그쪽으로 교체한다(transit-en 세션 최소 구현, 코디네이터 신고 대상).
 */
export function TransitBilingualName({ en, ko }: { en: string; ko?: string | null }): ReactNode {
  if (!ko || ko === en) return en;
  return (
    <>
      {en}
      <span lang="ko" aria-hidden="true">
        {` (${ko})`}
      </span>
    </>
  );
}
