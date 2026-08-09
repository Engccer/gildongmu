import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { assembleScene } from "@/lib/surroundings-scene";

/**
 * GET /api/surroundings/scene?lat=..&lng=..
 * 앵커 주변을 입구 기준 좌우로 재구성한다(M1). 축을 못 세우면 방위 폴백이라
 * 200이고, 조회 실패만 502다(3-state).
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
  if (!hasKakaoKey()) return NextResponse.json({ data: null });
  try {
    const data = await assembleScene(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[surroundings/scene] 조립 실패:", e);
    return NextResponse.json(
      { error: "주변 정보를 조회하지 못했습니다." },
      { status: 502 },
    );
  }
}
