import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";

/**
 * 역 교통약자 편의시설 프록시 (한국철도공사 B551457).
 *
 * data.go.kr serviceKey는 서버 전용 env에만 존재한다. 미커버 역·키 없음은
 * provider가 null을 돌려주고, 라우트는 그대로 { facilities: null }을 200으로
 * 응답한다 — 클라이언트가 "정보 없음"으로 graceful degrade한다.
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
    const facilities = await fetchStationFacilities(parsed.data.station);
    return NextResponse.json({ facilities }); // null이면 미커버 역
  } catch (e) {
    console.error("[api/station/facilities] 편의시설 조회 실패:", e);
    return NextResponse.json({ error: "편의시설 조회 실패" }, { status: 502 });
  }
}
