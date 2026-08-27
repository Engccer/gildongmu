/**
 * 장소 상세 줄 조립(`place-lines/*`)이 받는 번역 함수 계약.
 *
 * `src/lib`는 React/Next 비의존이라 next-intl 훅을 직접 부르지 않고, 화면이
 * `useTranslations(ns)`의 반환값을 그대로 넘긴다. 도구층(WebMCP)도 같은 함수를
 * 같은 `t`로 불러 화면 문장과 byte-identical한 줄을 얻는다(spec 2026-08-29 §3.3).
 */
export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;
