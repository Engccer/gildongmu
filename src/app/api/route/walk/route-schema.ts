import { z } from "zod";
import { coordSchema } from "@/lib/route-coord-schema";

/**
 * 도보 길찾기 쿼리 스키마·조합표(M3 spec §3.1). 라우트에서 분리해 단위 검증한다.
 *
 * 옵트인 값 검증은 includeGeometry 관례 동형: 누락 또는 정확한 값만, 그 외 400 —
 * 옵트인을 조용히 무시하지 않는다. 금지 조합 2건은 superRefine으로 400:
 * - variant+alternatives: 상호 배타(単경로 조회와 복수 조회는 다른 소비자).
 * - alternatives+includeGeometry: 조회 화면은 기하 불필요, 両경로 기하는 응답만
 *   키운다(기하는 안내 시작 시 variant 단일 조회로).
 */
const querySchema = z
  .object({
    origin: coordSchema,
    dest: coordSchema,
    // 부재(null) → false. "true"/"false" 외 값(1·yes·True 등)은 union 불일치로 400 —
    // 안전 옵션(계단 회피)을 조용히 기본 모드로 강등하지 않는다.
    accessible: z
      .union([z.literal("true"), z.literal("false")])
      .nullable()
      .transform((v) => v === "true"),
    // 스텝 폴리라인 보존 옵트인(실시간 길 안내). 누락 또는 정확히 "1"만(스펙 §7.2).
    includeGeometry: z
      .union([z.literal("1"), z.null()])
      .transform((v) => v === "1"),
    // 경로 축(M3): 누락 또는 정확히 "shortest"만.
    variant: z
      .union([z.literal("shortest"), z.null()])
      .transform((v) => v ?? undefined),
    // 추천+최단 병렬 조회 옵트인(M3): 누락 또는 정확히 "1"만.
    alternatives: z
      .union([z.literal("1"), z.null()])
      .transform((v) => v === "1"),
  })
  .superRefine((data, ctx) => {
    if (data.variant && data.alternatives) {
      ctx.addIssue({
        code: "custom",
        message: "variant와 alternatives는 함께 지정할 수 없습니다.",
      });
    }
    if (data.alternatives && data.includeGeometry) {
      ctx.addIssue({
        code: "custom",
        message: "alternatives 조회는 includeGeometry를 지원하지 않습니다.",
      });
    }
  });

export type WalkQuery = z.infer<typeof querySchema>;

export type ParseWalkQueryResult =
  | { ok: true; data: WalkQuery }
  | { ok: false; error: string };

export function parseWalkQuery(raw: {
  origin: string;
  dest: string;
  accessible: string | null;
  includeGeometry: string | null;
  variant: string | null;
  alternatives: string | null;
}): ParseWalkQueryResult {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" };
  }
  return { ok: true, data: parsed.data };
}
