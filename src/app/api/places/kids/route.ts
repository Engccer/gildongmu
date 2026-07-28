import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * GET /api/places/kids?lat=..&lng=..[&limit=N]
 * 근처 아이 놀 곳(키즈카페·놀이터·어린이공원, B3).
 *
 * 카카오 로컬 키워드 3종(키즈카페·놀이터·어린이공원) 좌표 근접 병렬 호출 → 카테고리
 * 화이트리스트로 거짓양성 제거 → dedupe·거리순·상위 N. 신규 API·게이트 없음.
 *
 * 기본 응답 상한은 8(종전 캡) — limit 미지정 소비자(CLI/MCP·현행 iOS)의 출력이
 * 부풀지 않게 유지한다. "더 보기" 단계 공개를 하는 웹 클라이언트만 옵트인
 * `limit`(정수 1~50)으로 확장 요청한다. `total`은 절단 전 서버가 아는 후보 수
 * (provider 캡 50 이내) — 침묵 절단 금지.
 *
 * 키 없음 → { kids: [], total: 0 }(canShowKids 게이트와 이중 방어).
 * upstream 전부 실패 → 502("조회 실패"와 "근처에 없음"을 구분). 빈 결과 → []graceful.
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
  if (!hasKakaoKey()) {
    return NextResponse.json({ kids: [], total: 0 });
  }
  try {
    const all = await findKidsPlacesNear(parsed.data.lat, parsed.data.lng);
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    return NextResponse.json({ kids: all.slice(0, limit), total: all.length });
  } catch (e) {
    console.error("[api/places/kids]", e);
    return NextResponse.json(
      { error: "아이 놀 곳 정보 조회 실패" },
      { status: 502 },
    );
  }
}
