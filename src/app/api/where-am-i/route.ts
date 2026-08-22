import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { assembleWhereAmI } from "@/lib/where-am-i";

/**
 * GET /api/where-am-i?lat=..&lng=..
 * "현재 위치" 정위 카드 — 주소·행정동·근접역·주변 기준점을 병렬 조립.
 * 키 없음 → { data: null }(CLI·채팅 소비자가 부재로 읽는다 — 웹 둘러보기는 `/api/nearby/overview`를 쓴다).
 * 네 조각 전부 비면 502(조회 실패 ≠ 정보 없음), 그 외 200.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
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
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasKakaoKey()) {
    return NextResponse.json({ data: null });
  }
  try {
    const data = await assembleWhereAmI(parsed.data.lat, parsed.data.lng);
    const empty =
      !data.address &&
      !data.region &&
      !data.nearestStation &&
      data.landmarks.length === 0;
    if (empty) {
      return NextResponse.json({ error: "현재 위치 정보를 찾지 못했습니다" }, { status: 502 });
    }
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[api/where-am-i]", e);
    return NextResponse.json({ error: "현재 위치 조회 실패" }, { status: 502 });
  }
}
