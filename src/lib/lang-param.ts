import { z } from "zod";

/**
 * 응답 언어 쿼리 `lang`(E27) — walk `route-schema.ts`의 `lang`과 같은 계약.
 * 누락="ko", 그 외는 정확히 "ko"/"en"만 — 알 수 없는 값을 조용히 ko로 강등하면 en 소비자가
 * 한국어 데이터를 받고도 그 사실을 알 수 없다(400이 정직하다).
 */
export const langParam = () =>
  z.union([z.literal("ko"), z.literal("en"), z.null()]).transform((v) => v ?? "ko");

export type DataLang = "ko" | "en";
