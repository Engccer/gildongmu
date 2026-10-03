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
 * - lines(E42)+variant·alternatives·includeGeometry·accessible=true: 줄 목록은 단독 옵트인.
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
    // 추천+최단 병렬 조회 옵트인(M3): 누락 또는 정확히 "1"만. 옛 조회 화면(iOS 1.x·안드로이드) 호환.
    alternatives: z
      .union([z.literal("1"), z.null()])
      .transform((v) => v === "1"),
    // 조회 화면 줄 목록 옵트인(E42): 누락 또는 정확히 "1"·"2"만. 응답 `{ lines }`. 값은 줄 목록 계약의
    // 판본이다(E52): 1 = 최대 두 줄(배포된 iOS 1.19), 2 = 최대 세 줄 — `WalkLinesVersion`.
    lines: z
      .union([z.literal("1"), z.literal("2"), z.null()])
      .transform((v) => (v === null ? undefined : v === "2" ? (2 as const) : (1 as const))),
    // 경유지 1개(N4): 누락=없음, 형식은 origin·dest와 같다. 형식 오류는 400 —
    // 조용히 버리면 "경유 안 한 경로"를 "경유한 경로"로 낭독하게 된다.
    // variant·alternatives·accessible과 직교한다(금지 조합 없음).
    via: coordSchema.nullable().transform((v) => v ?? undefined),
    // 안내 문장 언어(E16 축3): 누락="ko", 그 외는 정확히 "ko"/"en"만 — 알 수 없는 값을
    // 조용히 ko로 강등하면 en 소비자가 한국어 안내를 받고도 그 사실을 알 수 없다.
    lang: z
      .union([z.literal("ko"), z.literal("en"), z.null()])
      .transform((v) => v ?? "ko"),
    // 안내 문장 판본(E62): 누락 = 1(종전 — 스토어 iOS 2.0·1.19·안드로이드), 정확히 "2"만 옵트인.
    wording: z
      .union([z.literal("2"), z.null()])
      .transform((v) => (v === "2" ? (2 as const) : (1 as const))),
    // 건너는 길 이름(E62, iOS 실험판만): 누락 또는 정확히 "1". 판본 2에서만 뜻이 있다.
    crossingRoad: z
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
    // 판본 2 선택지를 판본 1에 붙이면 조용히 무시되므로 400. `alternatives`는 옛 조회 화면 전용이라 판본 1 고정.
    if (data.crossingRoad && data.wording !== 2) {
      ctx.addIssue({ code: "custom", message: "crossingRoad는 wording=2와 함께만 지정할 수 있습니다." });
    }
    if (data.alternatives && data.wording === 2) {
      ctx.addIssue({ code: "custom", message: "alternatives 조회는 wording=2를 지원하지 않습니다." });
    }
    // 줄 목록(E42)은 조회 화면 전용 단독 옵트인이다 — 줄 종류가 탐색 축(최단·계단 회피)을 이미
    // 담으므로 variant·accessible과 겹치면 어느 축인지 모호하고, 기하는 안내 시작의 단일 조회가 싣는다.
    if (data.lines && (data.variant || data.alternatives || data.includeGeometry || data.accessible)) {
      ctx.addIssue({
        code: "custom",
        message: "lines 조회는 variant·alternatives·includeGeometry·accessible=true와 함께 지정할 수 없습니다.",
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
  lines: string | null;
  via: string | null;
  lang: string | null;
  wording: string | null;
  crossingRoad: string | null;
}): ParseWalkQueryResult {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" };
  }
  return { ok: true, data: parsed.data };
}
