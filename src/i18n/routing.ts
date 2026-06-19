import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // ko: 기본 / en·es·fr·it: 외국인 여행자(dodo-planet과 동일 5개 언어).
  // UI 텍스트는 5개 언어 모두 번역하되, 외부 API(카카오·TourAPI·NCP·juso)는
  // ko/en만 제공하므로 비한국어 로케일의 외부 데이터는 영문을 공유한다
  // (src/lib/data-locale.ts의 dataLocale). 일본어·중국어는 이후 추가 여지.
  locales: ["ko", "en", "es", "fr", "it"],
  defaultLocale: "ko",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
