import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchBusRouteStops } from "@/lib/providers/tago-bus";

/**
 * GET /api/bus/route?cityCode=..&routeId=..
 * 노선 경유정류소(lazy, 펼칠 때만). 거의 불변이라 provider에서 하루 캐시.
 */
const querySchema = z.object({
  cityCode: z.string().min(1),
  routeId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    cityCode: request.nextUrl.searchParams.get("cityCode") ?? "",
    routeId: request.nextUrl.searchParams.get("routeId") ?? "",
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
    const stops = await fetchBusRouteStops(
      parsed.data.cityCode,
      parsed.data.routeId,
    );
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/route]", e);
    return NextResponse.json({ error: "경유 정류소 조회 실패" }, { status: 502 });
  }
}
