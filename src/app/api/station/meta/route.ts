import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findStationMeta } from "@/lib/subway-stations";

/**
 * 도시철도역 메타 조회 (A3, 전국도시철도역사정보 표준데이터 정적 seed).
 *
 * seed(src/lib/data/subway-stations.json, 1,098역)는 서버 전용 import라
 * 클라이언트 번들에서 제외하기 위해 이 라우트를 경유한다. 정적 데이터라
 * 외부 I/O가 없어 실패 경로가 없고, 미커버 역은 meta:null로 graceful degrade.
 * 연 1회 갱신(차기 2026-12)이라 응답을 하루 캐시한다.
 */

const schema = z.object({ station: z.string().trim().min(1).max(50) });

export const revalidate = 86_400; // 하루 — seed는 연 1회 갱신

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const meta = findStationMeta(parsed.data.station); // 미커버 역이면 null
  return NextResponse.json({ meta });
}
