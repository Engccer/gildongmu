import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchNearbyBusStops } from "@/lib/bus";

/**
 * GET /api/bus/nearby?lat=..&lng=..
 * 좌표 근접 정류소 + 각 정류소 도착예정. 실시간이라 캐시하지 않는다.
 *
 * 좌표는 한국 위경도 범위(위도 33~43, 경도 124~132)로 가드한다 — 무의미한
 * 좌표가 provider까지 통과하지 않도록(다른 라우트의 zod safeParse 컨벤션과 통일).
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
    return NextResponse.json({ stops: [] });
  }
  try {
    const stops = await fetchNearbyBusStops(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/nearby]", e);
    return NextResponse.json({ error: "버스 정보 조회 실패" }, { status: 502 });
  }
}
