import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchSubwayArrivals } from "@/lib/providers/seoul-subway-arrival";

/**
 * 서울 지하철 실시간 도착정보 프록시 (서울 열린데이터광장 OA-12764).
 *
 * SEOUL_SUBWAY_REALTIME_KEY는 서버 전용. 미커버 역(서울 도시철도 외)·키 없음은
 * provider가 null → { arrivals: null } 200으로 graceful degrade.
 * upstream 장애·인증/쿼터 오류만 502(seoul-metro-facilities 라우트와 동일 정책).
 *
 * 실시간이라 라우트도 캐시하지 않는다(provider fetch no-store + dynamic).
 */

export const dynamic = "force-dynamic";

const schema = z.object({ station: z.string().trim().min(1).max(50) });

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const arrivals = await fetchSubwayArrivals(parsed.data.station);
    return NextResponse.json({ arrivals }); // null이면 미커버 역
  } catch (e) {
    console.error("[api/station/subway-arrival] 조회 실패:", e);
    return NextResponse.json({ error: "지하철 도착 정보 조회 실패" }, { status: 502 });
  }
}
