import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { isInKorea } from "@/lib/coverage";
import { assembleNearbyOverview } from "@/lib/nearby-overview";

/**
 * GET /api/nearby/overview?lat=..&lng=..[&places=1]
 * "한눈에 보기"(M4) — 현재 위치 주변 6종을 공통 반경 1km로 한 번에 집계한다.
 * 키 게이트는 불릿 단위라 조립 안에 있다(키 없는 불릿 = 부재). 대중교통 불릿은 seed라
 * 키와 무관하게 항상 있으므로 `data: null` 상태는 없다(응답은 항상 data). 조립 자체의
 * 예외만 502(조각 실패는 불릿 `failed`로 200 안에 실린다 — 3-state).
 */
export const dynamic = "force-dynamic";

// `places=1`은 「한눈에 보기」 항목에 상세 진입 재료를 싣는다(E65, 앱 로터). 미지정 응답은 종전과 byte-identical.
const querySchema = z.object({ lat: latParam(), lng: lngParam(), places: z.enum(["1"]).optional() });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    places: request.nextUrl.searchParams.get("places") ?? undefined,
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
    // wire는 overview만 — `places` 배열(채팅 카드 투영)은 옵트인과 무관하게 싣지 않는다(CLI·MCP 출력 팽창 금지).
    // `places=1`은 불릿 항목에 상세 재료를 붙일 뿐이다.
    const { overview: data } = await assembleNearbyOverview(
      parsed.data.lat, parsed.data.lng, parsed.data.places === "1");
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[nearby/overview] 조립 실패:", e);
    return NextResponse.json(
      { error: "주변 정보를 조회하지 못했습니다." },
      { status: 502 },
    );
  }
}
