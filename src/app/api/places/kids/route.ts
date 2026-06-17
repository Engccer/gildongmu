import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";

/**
 * GET /api/places/kids?lat=..&lng=..
 * 근처 아이 놀 곳(키즈카페·놀이터·어린이공원, B3).
 *
 * 카카오 로컬 키워드 3종(키즈카페·놀이터·어린이공원) 좌표 근접 병렬 호출 → 카테고리
 * 화이트리스트로 거짓양성 제거 → dedupe·거리순·상위 N. 신규 API·게이트 없음.
 *
 * 키 없음 → { kids: [] }(canShowKids 게이트와 이중 방어).
 * upstream 전부 실패 → 502("조회 실패"와 "근처에 없음"을 구분). 빈 결과 → []graceful.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!hasKakaoKey()) {
    return NextResponse.json({ kids: [] });
  }
  try {
    const kids = await findKidsPlacesNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ kids });
  } catch (e) {
    console.error("[api/places/kids]", e);
    return NextResponse.json(
      { error: "아이 놀 곳 정보 조회 실패" },
      { status: 502 },
    );
  }
}
