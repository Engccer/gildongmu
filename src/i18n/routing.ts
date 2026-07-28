import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // ko: 기본 / en·es·fr·it·ja: 외국인 여행자.
  // UI 텍스트는 전 언어 번역하되, 외부 API(카카오·TourAPI·NCP·juso)는
  // ko/en만 제공하므로 비한국어 로케일의 외부 데이터는 영문을 공유한다
  // (src/lib/data-locale.ts의 dataLocale). 중국어는 이후 추가 여지.
  locales: ["ko", "en", "es", "fr", "it", "ja"],
  defaultLocale: "ko",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
