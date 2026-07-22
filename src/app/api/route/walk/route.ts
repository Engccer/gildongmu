import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasTmapKey } from "@/lib/env";
import { coordSchema } from "@/lib/route-coord-schema";
import { checkWalkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";

/**
 * 도보 길찾기 프록시(Tmap). 좌표는 "위도,경도" 순서(도메인 표준, transit route와 동형).
 *
 * 3-state 응답: 입력 오류(400) · 키 없음(404, 게이트) · 조회 실패(502)를 뭉개지 않는다.
 * Tmap도 일 1,000건 무료 쿼터가 있는 유료 API라 채팅과 동일한 IP 레이트리밋(60초 10회)으로
 * 호출 *전*에 비용을 방어한다.
 */

const querySchema = z.object({ origin: coordSchema, dest: coordSchema });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  if (!hasTmapKey()) {
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
    const result = await getWalkRouteBriefing(parsed.data);
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[api/route/walk] 도보 길찾기 실패:", e);
    return NextResponse.json(
      { error: "도보 길찾기에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
