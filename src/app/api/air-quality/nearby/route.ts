import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { findAirQualityNear } from "@/lib/providers/air-quality";

/**
 * GET /api/air-quality/nearby?lat=..&lng=..
 * 이 지역 공기질(B2) — WGS84→TM(EPSG:2097) 변환 후 근접 측정소 → 측정소 실시간.
 *
 * 키 없음 → { air: null }(canShowAir 게이트와 이중 방어).
 * 근접 측정소·측정 데이터 없음 → { air: null }(graceful 숨김).
 * upstream 장애 → 502("조회 실패"와 "정보 없음"을 구분).
 */

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
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
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ air: null });
  }
  try {
    const air = await findAirQualityNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ air });
  } catch (e) {
    console.error("[api/air-quality/nearby]", e);
    return NextResponse.json({ error: "공기질 정보 조회 실패" }, { status: 502 });
  }
}
