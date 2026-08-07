import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { searchPlaces } from "@/lib/providers/places";

/**
 * 장소 검색 프록시.
 *
 * 클라이언트는 이 라우트만 호출한다 — 네이버 API Secret은 서버에만 존재하고,
 * openapi.naver.com은 브라우저 CORS도 허용하지 않으므로 프록시가 필수다.
 */

const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  // 카카오 로컬 키워드 검색의 단일 요청 상한이 15건이다(과거 max(5)는 네이버
  // 지역검색 페이지당 5건 시절 잔재). 결과가 많으면 카테고리·지역 칩 필터가
  // 자연 분류하므로 인위적 상한을 두지 않고 provider 최대치를 그대로 노출한다.
  limit: z.coerce.number().int().min(1).max(15).default(15),
  lang: z.enum(["ko", "en"]).default("ko"),
  // 좌표는 검색 품질 보조 — 있으면 근접 블렌딩(정확도순)과 거리 주석, 무효/누락이면 좌표 없이 검색(400 아님).
  // `latParam`을 거치므로 빈 문자열도 `catch`로 흡수돼 "좌표 없음"이 된다
  // (`z.coerce.number()` 직접 사용 시 `Number("")===0`이라 적도 앞바다 기준으로 블렌딩된다).
  lat: latParam().optional().catch(undefined),
  lng: lngParam().optional().catch(undefined),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
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
    const result = await searchPlaces(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/places] 검색 실패:", e);
    return NextResponse.json(
      { error: "장소 검색에 실패했습니다." },
      { status: 502 },
    );
  }
}
