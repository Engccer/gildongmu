import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { searchAddress } from "@/lib/providers/kakao-address";

/**
 * 주소 → 좌표 (지오코딩) 프록시 — 카카오 로컬 주소 검색.
 *
 * 장소 검색과 달리 주소 변환은 실데이터만 의미가 있으므로
 * mock 폴백 없이 키 미등록 시 503을 반환한다.
 */

const querySchema = z.object({
  query: z.string().trim().min(1, "주소가 비어 있습니다").max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export async function GET(request: NextRequest) {
  if (!hasKakaoKey()) {
    return NextResponse.json(
      { error: "주소 변환은 카카오 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  try {
    const matches = await searchAddress(parsed.data.query, parsed.data.limit);
    return NextResponse.json({ matches, query: parsed.data.query });
  } catch (e) {
    console.error("[api/geocode] 주소 변환 실패:", e);
    return NextResponse.json(
      { error: "주소 변환에 실패했습니다." },
      { status: 502 },
    );
  }
}
