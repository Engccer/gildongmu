import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/providers/places";

/**
 * 장소 검색 프록시.
 *
 * 클라이언트는 이 라우트만 호출한다 — 네이버 API Secret은 서버에만 존재하고,
 * openapi.naver.com은 브라우저 CORS도 허용하지 않으므로 프록시가 필수다.
 */

const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  limit: z.coerce.number().int().min(1).max(5).default(5),
  lang: z.enum(["ko", "en"]).default("ko"),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
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
      { error: "장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
