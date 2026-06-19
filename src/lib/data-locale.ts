/**
 * UI 로케일 → 외부 데이터 언어(ko|en) 매핑 (순수, React/Next 비의존).
 *
 * 카카오·TourAPI·NCP·juso·카카오모빌리티 등 외부 소스는 한국어/영어 2가지
 * 표기만 제공한다. 한국어가 아닌 모든 UI 로케일(en/es/fr/it)은 영문 데이터를
 * 공유한다 — es/fr/it 전용 외부 데이터가 없으므로 en으로 합쳐 (1) `/api/places`
 * 의 zod enum(ko|en) 400 (2) 같은 영문 데이터의 로케일별 캐시 분절을 함께 막는다.
 *
 * 분리 원칙: UI 텍스트는 next-intl 메시지로 5개 언어 모두 번역되지만, 장소명·
 * 주소·역명 같은 외부 데이터의 비한국어 표기는 영문이다(데이터 현실의 한계).
 * STT(Deepgram nova-3)는 es/fr/it를 직접 인식하므로 이 매핑을 쓰지 않고 실제
 * 로케일을 그대로 전달한다.
 */
export function dataLocale(locale: string): "ko" | "en" {
  return locale === "ko" ? "ko" : "en";
}

/** 비한국어 로케일에서 영문 표기(영문 주소·영문 역명 등)를 메인으로 보일지. */
export function prefersEnglish(locale: string): boolean {
  return locale !== "ko";
}
