import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { findWeatherNear } from "@/lib/providers/weather";

/**
 * GET /api/weather/nearby?lat=..&lng=..
 * 이 지역 날씨 — 기상청 격자 변환 후 초단기실황+단기예보 합성.
 *
 * 키 없음 → { weather: null }(canShowAir 게이트와 이중 방어, 동일 키).
 * 무데이터·미커버 → { weather: null }(graceful). upstream 장애 → 502.
 */

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
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ weather: null });
  }
  try {
    const weather = await findWeatherNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ weather });
  } catch (e) {
    console.error("[api/weather/nearby]", e);
    return NextResponse.json({ error: "날씨 정보 조회 실패" }, { status: 502 });
  }
}
