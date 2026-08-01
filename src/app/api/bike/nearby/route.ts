import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";

/**
 * GET /api/bike/nearby?lat=..&lng=..
 * 좌표 근접 따릉이 대여소(1km 이내 상위 5). provider가 60초 revalidate.
 *
 * 좌표는 전지구 범위로 형식만 가드하고, 한국 밖은 커버리지 마커로 응답한다(버스 라우트와 통일).
 */
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
  if (!hasSeoulOpenDataKey()) {
    return NextResponse.json({ stations: [] });
  }
  try {
    const stations = await fetchNearbyBikeStations(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ stations });
  } catch (e) {
    console.error("[api/bike/nearby]", e);
    return NextResponse.json({ error: "따릉이 정보 조회 실패" }, { status: 502 });
  }
}
