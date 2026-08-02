import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { findEventsNear, isEventServiceArea } from "@/lib/culture-events";
import { latParam, lngParam } from "@/lib/coord-param";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * GET /api/events/nearby?lat=..&lng=..[&limit=N]
 * 내 주변 문화행사(서울 `culturalEventInfo`, OA-15486).
 *
 * 오늘(KST) 진행 중인 행사 중 반경 3km를 거리순으로. 진행 판정·거리 정렬은
 * 코드 책임이고(API의 DATE 필터는 "그날 열리는 행사"가 아니라 문자열 부분일치라
 * 못 쓴다 — 설계 §1-2), provider가 전수를 일자별로 캐시한다.
 *
 * 기본 상한 12 — limit 미지정 소비자(CLI/MCP)의 출력이 부풀지 않게. "더 보기"를
 * 하는 웹·iOS만 옵트인 `limit`(1~50)으로 확장 요청한다. `total`은 반경 내
 * 절단 전 전체 수.
 *
 * 데이터가 서울 전용이라 서울 밖 국내 좌표는 **빈 배열**이 정직한 답이다
 * (오류 아님 — 따릉이 동형). 국외는 커버리지 마커로 가른다.
 *
 * 키 없음 → { events: [], total: 0 }(canShowEvents 게이트와 이중 방어).
 * upstream 장애 → 502("조회 실패"와 "근처에 없음"을 구분).
 */

export const dynamic = "force-dynamic";

/** limit 미지정 시 기본 상한 — 소비자 출력 불변 계약(둘러보기와 동일). */
const DEFAULT_LIMIT = 12;

// 좌표는 `latParam`/`lngParam`을 쓴다(`z.coerce.number()` 직접 사용 시
// `Number("")===0` 함정 — `@/lib/coord-param` 주석 참조).
const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
  limit: z.coerce.number().int().min(1).max(NEARBY_LIMIT_MAX).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
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
  // 서울 밖은 "오늘 행사 없음"이 아니라 "이 지역 행사 정보 미보유"(3-state).
  if (!isEventServiceArea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ unavailableHere: "seoulOnly" });
  }
  if (!hasSeoulOpenDataKey()) {
    return NextResponse.json({ events: [], total: 0 });
  }
  try {
    const { events, total } = await findEventsNear(parsed.data.lat, parsed.data.lng);
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    return NextResponse.json({ events: events.slice(0, limit), total });
  } catch (e) {
    console.error("[api/events/nearby]", e);
    return NextResponse.json({ error: "문화행사 정보 조회 실패" }, { status: 502 });
  }
}
