import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { latParam, lngParam } from "@/lib/coord-param";
import { findCongestionNear } from "@/lib/congestion";
import { checkCongestionRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * GET /api/congestion/nearby?lat=..&lng=..
 * 실시간 인구 혼잡도(서울 `citydata_ppltn`).
 *
 * 서울시가 혼잡도를 재는 121개 핫스팟 중 사용자가 서 있는 곳을 판정해
 * 그 영역의 등급을 낸다. 영역 경계는 미공개라, 영역을 구성하는 지하철역·
 * 버스정류장 좌표(전체 `citydata`가 제공)로 범위를 정의한다 — 최근접 구성
 * 지점 300m 이내(설계 §1-4).
 *
 * **영역 밖은 오류가 아니다**: `{ area: null }`. 서울의 91%가 여기 해당하고,
 * 이때 upstream을 부르지 않는다. 조회 실패만 502로 가른다.
 *
 * 예보(`FCST_PPLTN`)는 응답에 싣지 않는다 — UI가 표기하지 않으므로 보낼
 * 이유가 없다. 채팅은 서비스를 직접 호출해 예보를 본다(설계 §2-6).
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({ lat: latParam(), lng: lngParam() });

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
  // 커버리지 마커가 키 게이트보다 앞 — 국외 좌표는 upstream을 부르지 않는다.
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasSeoulOpenDataKey()) {
    return NextResponse.json({ area: null });
  }
  if (!checkCongestionRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json({ error: "요청이 너무 잦습니다" }, { status: 429 });
  }
  try {
    const { area } = await findCongestionNear(parsed.data.lat, parsed.data.lng);
    if (!area) return NextResponse.json({ area: null });
    // 필드를 명시 나열한다 — forecast를 빼는 것이 의도임을 코드로 남기고,
    // 서비스에 필드가 늘어도 응답 스키마가 조용히 넓어지지 않게.
    return NextResponse.json({
      area: {
        code: area.code,
        name: area.name,
        level: area.level,
        message: area.message,
        asOf: area.asOf,
      },
    });
  } catch (e) {
    console.error("[api/congestion/nearby]", e);
    return NextResponse.json({ error: "혼잡도 조회 실패" }, { status: 502 });
  }
}
