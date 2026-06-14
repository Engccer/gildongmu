import { NextResponse } from "next/server";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchNearbyBusStops } from "@/lib/providers/tago-bus";

/**
 * GET /api/bus/nearby?lat=..&lng=..
 * 좌표 근접 정류소 + 각 정류소 도착예정. 실시간이라 캐시하지 않는다.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng 필요" }, { status: 400 });
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ stops: [] });
  }
  try {
    const stops = await fetchNearbyBusStops(lat, lng);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/nearby]", e);
    return NextResponse.json({ error: "버스 정보 조회 실패" }, { status: 502 });
  }
}
