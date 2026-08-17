import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";

/**
 * `/api/places` 쿼리 스키마(라우트에서 분리 — 단위 테스트 대상, walk `route-schema.ts` 동형).
 */
export const placesQuerySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  // 카카오 로컬 키워드 검색의 단일 요청 상한이 15건이다(과거 max(5)는 네이버
  // 지역검색 페이지당 5건 시절 잔재). 결과가 많으면 카테고리·지역 칩 필터가
  // 자연 분류하므로 인위적 상한을 두지 않고 provider 최대치를 그대로 노출한다.
  limit: z.coerce.number().int().min(1).max(15).default(15),
  lang: z.enum(["ko", "en"]).default("ko"),
  // 좌표는 검색 품질 보조 — 있으면 근접 블렌딩(정확도순)과 거리 주석, 무효/누락이면 좌표 없이 검색(400 아님).
  // `latParam`을 거치므로 빈 문자열도 `catch`로 흡수돼 "좌표 없음"이 된다
  // (`z.coerce.number()` 직접 사용 시 `Number("")===0`이라 적도 앞바다 기준으로 블렌딩된다).
  // ⚠ 리뷰순(sort=review)에서 좌표는 검색에 쓰이지 않고 **거리 표기에만** 쓰인다(네이버가
  // 좌표를 무시한다, spec 2026-08-17 §3.2). 순위에 영향을 준다고 오해하지 말 것.
  lat: latParam().optional().catch(undefined),
  lng: lngParam().optional().catch(undefined),
  // review = 네이버 리뷰 개수순 단독(최대 5건 — limit은 무시된다). 무효값은 400(조용한 무시 금지).
  sort: z.enum(["accuracy", "review"]).default("accuracy"),
});

export type PlacesQuery = z.infer<typeof placesQuerySchema>;

export function parsePlacesQuery(
  sp: URLSearchParams,
): { ok: true; data: PlacesQuery } | { ok: false; message: string } {
  const parsed = placesQuerySchema.safeParse({
    query: sp.get("query") ?? "",
    limit: sp.get("limit") ?? undefined,
    lang: sp.get("lang") ?? undefined,
    lat: sp.get("lat") ?? undefined,
    lng: sp.get("lng") ?? undefined,
    sort: sp.get("sort") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "잘못된 요청" };
  }
  return { ok: true, data: parsed.data };
}
