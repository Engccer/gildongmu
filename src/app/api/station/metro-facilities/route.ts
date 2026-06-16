import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";

/**
 * 서울 지하철역 교통약자 시설 프록시 (서울교통공사 B553766).
 *
 * DATA_GO_KR_API_KEY는 서버 전용. 미커버 역(도시철도 외)·키 없음은
 * provider가 null → { facilities: null } 200으로 graceful degrade.
 * upstream 장애만 502(코레일 라우트와 동일 정책).
 */

const schema = z.object({ station: z.string().trim().min(1).max(50) });

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const facilities = await fetchSeoulMetroFacilities(parsed.data.station);
    return NextResponse.json({ facilities }); // null이면 미커버 역
  } catch (e) {
    console.error("[api/station/metro-facilities] 조회 실패:", e);
    return NextResponse.json({ error: "지하철역 시설 조회 실패" }, { status: 502 });
  }
}
