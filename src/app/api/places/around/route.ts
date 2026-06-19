import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { findSurroundingsNear } from "@/lib/providers/surroundings";

/**
 * GET /api/places/around?lat=..&lng=..
 * 내 주변 둘러보기(기능 A) — 카카오 카테고리 8종 좌표 근접 병합, 거리·방위 포함.
 * 키 없음 → { places: [] }(canShowSurroundings 게이트와 이중 방어).
 * upstream 전부 실패 → 502. 빈 결과 → [] graceful.
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
    return NextResponse.json({ places: [] });
  }
  try {
    const places = await findSurroundingsNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ places });
  } catch (e) {
    console.error("[api/places/around]", e);
    return NextResponse.json({ error: "주변 정보 조회 실패" }, { status: 502 });
  }
}
