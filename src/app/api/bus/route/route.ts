import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchBusRouteStops } from "@/lib/providers/tago-bus";
import { fetchSeoulRouteStops } from "@/lib/providers/seoul-bus";

/**
 * GET /api/bus/route?source=tago&cityCode=..&routeId=..
 *      /api/bus/route?source=seoul&routeId=..
 * 노선 경유정류소(lazy, 펼칠 때만). source로 provider 디스패치. 거의 불변이라 provider에서 하루 캐시.
 */
const querySchema = z
  .object({
    source: z.enum(["tago", "seoul"]),
    routeId: z.string().min(1),
    cityCode: z.string().optional(),
  })
  .refine((v) => v.source !== "tago" || (v.cityCode != null && v.cityCode.length > 0), {
    message: "tago source는 cityCode가 필요합니다",
    path: ["cityCode"],
  });

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    source: sp.get("source") ?? "",
    routeId: sp.get("routeId") ?? "",
    cityCode: sp.get("cityCode") ?? undefined,
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
    const { source, routeId, cityCode } = parsed.data;
    const stops =
      source === "seoul"
        ? await fetchSeoulRouteStops(routeId)
        : await fetchBusRouteStops(cityCode!, routeId);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/route]", e);
    return NextResponse.json({ error: "경유 정류소 조회 실패" }, { status: 502 });
  }
}
