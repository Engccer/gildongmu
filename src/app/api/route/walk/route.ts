import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasWalkRouteKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { checkWalkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getWalkRoute } from "@/lib/walk-route";

/**
 * 도보 길찾기 프록시(기본 카카오·폴백 Tmap). 좌표는 "위도,경도" 순서(도메인 표준, transit route와 동형).
 *
 * 3-state 응답: 입력 오류(400) · 한국 밖(200 outOfCoverage 마커) · 키 없음(404, 게이트) ·
 * 조회 실패(502)를 뭉개지 않는다.
 * 두 provider 모두 유료 API라 채팅과 동일한 IP 레이트리밋(60초 10회)으로
 * 호출 *전*에 비용을 방어한다.
 */

const querySchema = z.object({
  origin: coordSchema,
  dest: coordSchema,
  // 부재(null) → false. "true"/"false" 외 값(1·yes·True 등)은 union 불일치로 400 —
  // 안전 옵션(계단 회피)을 조용히 기본 모드로 강등하지 않는다.
  accessible: z
    .union([z.literal("true"), z.literal("false")])
    .nullable()
    .transform((v) => v === "true"),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
    accessible: request.nextUrl.searchParams.get("accessible"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  const { origin, dest } = parsed.data;
  if (!isInKorea(origin.lat, origin.lng) || !isInKorea(dest.lat, dest.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }

  if (!hasWalkRouteKey()) {
    return NextResponse.json(
      { error: "도보 길찾기는 API 키 등록 후 사용할 수 있습니다." },
      { status: 404 },
    );
  }

  if (!checkWalkRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  try {
    const result = await getWalkRoute(parsed.data);
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[api/route/walk] 도보 길찾기 실패:", e);
    return NextResponse.json(
      { error: "도보 길찾기에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
