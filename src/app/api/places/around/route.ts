import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * GET /api/places/around?lat=..&lng=..[&limit=N]
 * 내 주변 둘러보기(기능 A) — 카카오 카테고리 좌표 근접 병합, 거리·방위 포함.
 *
 * 기본 응답 상한은 12(종전 캡) — limit 미지정 소비자(CLI/MCP·현행 iOS)의 출력이
 * 부풀지 않게 유지한다. "더 보기" 단계 공개를 하는 웹 클라이언트만 옵트인
 * `limit`(정수 1~50)으로 확장 요청한다. `total`은 절단 전 서버가 아는 후보 수
 * (provider 캡 50 이내) — 침묵 절단 금지.
 *
 * 키 없음 → { places: [], total: 0 }(canShowSurroundings 게이트와 이중 방어).
 * upstream 전부 실패 → 502. 빈 결과 → [] graceful.
 */

export const dynamic = "force-dynamic";

/** limit 미지정 시 기본 상한 — ea18f6b 이전의 종전 캡(소비자 출력 불변 계약). */
const DEFAULT_LIMIT = 12;

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
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasKakaoKey()) {
    return NextResponse.json({ places: [], total: 0 });
  }
  try {
    const all = await findSurroundingsNear(parsed.data.lat, parsed.data.lng);
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    return NextResponse.json({ places: all.slice(0, limit), total: all.length });
  } catch (e) {
    console.error("[api/places/around]", e);
    return NextResponse.json({ error: "주변 정보 조회 실패" }, { status: 502 });
  }
}
