import { NextResponse } from "next/server";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchBusRouteStops } from "@/lib/providers/tago-bus";

/**
 * GET /api/bus/route?cityCode=..&routeId=..
 * 노선 경유정류소(lazy, 펼칠 때만). 거의 불변이라 provider에서 하루 캐시.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cityCode = searchParams.get("cityCode") ?? "";
  const routeId = searchParams.get("routeId") ?? "";
  if (!cityCode || !routeId) {
    return NextResponse.json({ error: "cityCode/routeId 필요" }, { status: 400 });
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ stops: [] });
  }
  try {
    const stops = await fetchBusRouteStops(cityCode, routeId);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/route]", e);
    return NextResponse.json({ error: "경유 정류소 조회 실패" }, { status: 502 });
  }
}
