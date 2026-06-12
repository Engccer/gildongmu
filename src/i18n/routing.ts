import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // ko: 기본 / en: 외국인 여행자. 일본어·중국어는 UI 안정화 후 추가 예정
  // (네이버 지도 JS SDK도 ko/en/ja/zh를 지원하므로 확장 시 라벨까지 일치 가능)
  locales: ["ko", "en"],
  defaultLocale: "ko",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
