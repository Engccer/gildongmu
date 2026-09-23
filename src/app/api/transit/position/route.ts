import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkTransitPositionRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { trackSubwayPosition } from "@/lib/transit-position";

/**
 * 승차 중 잠근 열차의 현재역(E35, spec `2026-09-23-riding-current-station-design.md` §3.2).
 * 폴링 소비자(웹 useTransitGuide·iOS TransitGuideModel) 전용 — 실시간이라 응답을 캐시하지 않는다
 * (upstream 노선 목록 20초 캐시는 provider 몫). 좌표 입력이 없어 커버리지 마커는 해당 없다.
 * 순서: 파싱 → 노선 매핑·키 게이트(unsupported) → upstream(실패는 502).
 *
 * `lang`은 받지 않는다 — 역명은 조인 키로만 쓰이고 화면 라벨은 leg 경유역 표시 투영에서 고른다.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  line: z.string().trim().min(1).max(30),
  train: z.string().trim().regex(/^[0-9A-Za-z]{1,10}$/),
});

export async function GET(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);
  if (!checkTransitPositionRateLimit(ip, Date.now())) {
    return NextResponse.json({ error: "요청이 너무 잦습니다." }, { status: 429 });
  }
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const result = await trackSubwayPosition({
      lineName: parsed.data.line,
      trainNo: parsed.data.train,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/transit/position] 위치 조회 실패:", e);
    return NextResponse.json({ error: "실시간 위치 조회에 실패했습니다." }, { status: 502 });
  }
}
