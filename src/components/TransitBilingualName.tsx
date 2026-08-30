"use client";

import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { bilingualName } from "@/lib/bilingual-name";
import { hasHangul } from "@/lib/format";

/**
 * 영문 이름 + 한글 괄호 병기(위원장 판정 4, E27 §3.6): 시각은 `Gangnam (강남)`, 접근 가능한 이름은
 * 영문뿐(괄호부 `lang="ko" aria-hidden`). 괄호 한글은 **시각 전용 정보**다 — SR 사용자에겐 들리지
 * 않으므로 오류 안전망으로 계산하지 않는다(설계 리뷰 #14).
 *
 * "무엇을 1순위로, 무엇을 괄호에"는 E28 정본 `bilingualName`이 정한다(ko 로케일·후보 부재·両동일이면
 * 병기 없음). 이 컴포넌트는 그 결과의 대중교통 자리 렌더뿐이다 — 괄호 span은 접근성 객체의 마지막 노드.
 */
export function TransitBilingualName({ en, ko }: { en: string; ko?: string | null }): ReactNode {
  const locale = useLocale();
  const b = bilingualName(locale, ko ?? en, { en });
  // 후보에 한글이 섞여 정본이 한글 원문으로 되돌린 경우(§3.8 게이트가 막는 이론 경로) — 태그 없이 두면 영어 음성이 한글을 읽는다.
  if (b.secondary === null) return hasHangul(b.primary) ? <span lang="ko">{b.primary}</span> : b.primary;
  return (
    <>
      {b.primary}
      <span lang="ko" aria-hidden="true">
        {` (${b.secondary})`}
      </span>
    </>
  );
}
