import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasSeoulSubwayRealtimeKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { fetchNearbySubwayArrivals } from "@/lib/providers/subway-nearby";

/**
 * GET /api/station/subway-arrival/nearby?lat=..&lng=..
 * 내 주변 서울 지하철역 실시간 도착(A2 홈 진입점) — 좌표→근접역→역별 실시간 합성.
 *
 * 키 없음 → { stations: [] }(canShowSubway 게이트와 이중 방어).
 * 부분 실패는 provider가 역별 arrivalStatus로 흡수 → 200. 전부 실패만 502.
 * 실시간이라 캐시하지 않는다(provider fetch no-store + dynamic).
 *
 * 좌표는 전지구 범위로 형식만 가드하고, 한국 밖은 커버리지 마커로 응답한다
 * (버스/따릉이 nearby 라우트와 통일).
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
  if (!hasSeoulSubwayRealtimeKey()) {
    return NextResponse.json({ stations: [] });
  }
  try {
    const stations = await fetchNearbySubwayArrivals(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ stations });
  } catch (e) {
    console.error("[api/station/subway-arrival/nearby]", e);
    return NextResponse.json({ error: "지하철 도착 정보 조회 실패" }, { status: 502 });
  }
}
