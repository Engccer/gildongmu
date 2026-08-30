"use client";

import { useLocale } from "next-intl";
import { bilingualName, type BilingualName, type BilingualSource } from "@/lib/bilingual-name";
import { hasHangul } from "@/lib/format";

/**
 * 장소명 영문 병기 렌더 계층(E28) — spec §5. 규칙은 `bilingualName`이, **자리**는 여기가 정한다.
 *
 * Chrome 접근성 트리 실측(2026-08-31): `aria-hidden` span이 텍스트 **가운데** 있으면 앞뒤 텍스트
 * 노드가 StaticText 둘로 갈려 VoiceOver가 두 번 멈춘다(분절). span이 **마지막 노드**이거나
 * 이름이 계산되는 요소(`<button>`) 안이면 한 객체다. 그래서:
 * - R1. `<KoTail>`은 그 접근성 객체의 마지막 자식으로 둔다. 이름 단독 요소는 이름 바로 뒤가 곧
 *   끝이고, `joinText(name, …)` 합성 줄은 줄 끝이다(`Name, hospital, 500m (한글)`).
 * - R2. `<button>` 안에서는 이름 바로 뒤에 둘 수 있다(이름 계산). 앞 공백은 span 안에 있어
 *   계산된 이름에 이중 공백이 남지 않는다.
 * - R4. 줄의 `lang`은 **접근 텍스트** 기준(`langFor`) — 한글이 남은 합성 줄만 `ko`.
 */
export function useBilingualName(): (ko: string, source: BilingualSource) => BilingualName {
  const locale = useLocale();
  return (ko, source) => bilingualName(locale, ko, source);
}

/** 괄호부 — 시각 전용(`aria-hidden`), 한국어 엔진 힌트(`lang="ko"`). 병기 없으면 아무것도 렌더하지 않는다. */
export function KoTail({ secondary }: { secondary: string | null | undefined }) {
  if (!secondary) return null;
  return (
    <span lang="ko" aria-hidden="true">
      {` (${secondary})`}
    </span>
  );
}

/** 접근 텍스트에 한글이 남아 있을 때만 `lang="ko"` — 병기 뒤 라틴뿐인 줄은 페이지 언어를 따른다. */
export function langFor(accessibleText: string): "ko" | undefined {
  return hasHangul(accessibleText) ? "ko" : undefined;
}
