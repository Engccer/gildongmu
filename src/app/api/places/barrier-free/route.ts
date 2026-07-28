import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * GET /api/places/barrier-free?lat=..&lng=..[&limit=N]
 * 내 주변 무장애 관광지(한국관광공사 KorWithService2).
 *
 * 기본 응답 상한은 8(종전 캡) — limit 미지정 소비자(CLI/MCP·현행 iOS)의 출력이
 * 부풀지 않게 유지한다. "더 보기" 단계 공개를 하는 웹 클라이언트만 옵트인
 * `limit`(정수 1~50)으로 확장 요청한다. `total`은 절단 전 서버가 아는 후보 수
 * (provider 캡 50 이내) — 침묵 절단 금지.
 */

export const dynamic = "force-dynamic";

/** limit 미지정 시 기본 상한 — ea18f6b 이전의 종전 캡(소비자 출력 불변 계약). */
const DEFAULT_LIMIT = 8;

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
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
  if (!hasDataGoKrKey()) return NextResponse.json({ places: [], total: 0 });
  try {
    const all = await searchBarrierFreeNearby(parsed.data.lat, parsed.data.lng);
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    return NextResponse.json({ places: all.slice(0, limit), total: all.length });
  } catch (e) {
    console.error("[api/places/barrier-free]", e);
    return NextResponse.json({ error: "무장애 여행 정보 조회 실패" }, { status: 502 });
  }
}
