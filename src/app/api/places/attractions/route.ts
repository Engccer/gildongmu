import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey, hasTourApiKey } from "@/lib/env";
import { searchAttractions } from "@/lib/providers/attractions";

/**
 * 관광지·명소 검색 프록시 — 랜드마크를 surface한다(ko 카카오 정확도순 /
 * en TourAPI contentTypeId=76). 거리순 /api/places와 병렬로 호출되며,
 * 두 소스 키가 모두 없으면 빈 결과(死기능 0). 디스패처가 로케일별 소스를 고른다.
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  lang: z.enum(["ko", "en"]).default("ko"),
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});

export async function GET(request: NextRequest) {
  if (!hasKakaoKey() && !hasTourApiKey()) {
    return NextResponse.json({ places: [], provider: "none", query: "" });
  }
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
    lat: request.nextUrl.searchParams.get("lat") ?? undefined,
    lng: request.nextUrl.searchParams.get("lng") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  try {
    const result = await searchAttractions(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/places/attractions] 검색 실패:", e);
    return NextResponse.json(
      { error: "관광지 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
