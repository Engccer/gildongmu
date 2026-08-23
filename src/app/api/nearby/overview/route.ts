import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { isInKorea } from "@/lib/coverage";
import { assembleNearbyOverview } from "@/lib/nearby-overview";

/**
 * GET /api/nearby/overview?lat=..&lng=..
 * "한눈에 보기"(M4) — 현재 위치 주변 6종을 공통 반경 1km로 한 번에 집계한다.
 * 키 게이트는 불릿 단위라 조립 안에 있다(키 없는 불릿 = 부재). 대중교통 불릿은 seed라
 * 키와 무관하게 항상 있으므로 `data: null` 상태는 없다(응답은 항상 data). 조립 자체의
 * 예외만 502(조각 실패는 불릿 `failed`로 200 안에 실린다 — 3-state).
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({ lat: latParam(), lng: lngParam() });

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
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  try {
    // wire는 overview만 — 장소 투영(places)은 채팅 카드 전용이라 싣지 않는다(CLI·MCP 출력 팽창 금지).
    const { overview: data } = await assembleNearbyOverview(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[nearby/overview] 조립 실패:", e);
    return NextResponse.json(
      { error: "주변 정보를 조회하지 못했습니다." },
      { status: 502 },
    );
  }
}
