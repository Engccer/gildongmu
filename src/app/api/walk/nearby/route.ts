import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { getWalkInfrastructure } from "@/lib/walk-infra";
import { checkWalkInfraRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * GET /api/walk/nearby?lat&lng - 내 주변 보행 인프라(음향신호기+OSM 횡단보도·점자블록).
 *
 * 서비스 계층 getWalkInfrastructure만 호출한다(provider 직접 호출 금지, spec §1).
 * 두 소스 모두 error일 때만 503으로 판정하고, 한 소스만 실패해도 200으로 부분
 * 결과를 보존한다(3-state 불변식 - "정보 없음"·"조회 실패"를 뭉개지 않는다).
 * getWalkInfrastructure는 allSettled로 내부 실패를 전부 SourceStatus로 강등하므로
 * throw하지 않는다.
 */
// 좌표는 `latParam`/`lngParam`을 쓴다(`z.coerce.number()` 직접 사용 시
// `Number("")===0` 함정 — `@/lib/coord-param` 주석 참조). 파라미터 누락이 (0,0)으로
// 위장하면 이 라우트는 그것을 "커버리지 밖"이라는 그럴듯한 200으로 답하게 되므로
// 400 판정이 여전히 이 자리의 책임이다.
const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
});

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

  if (!checkWalkInfraRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  const walk = await getWalkInfrastructure(parsed.data.lat, parsed.data.lng);
  if (walk.audioSignals.status === "error" && walk.osm.status === "error") {
    return NextResponse.json(
      { error: "보행 인프라 정보 조회에 실패했습니다." },
      { status: 503 },
    );
  }
  return NextResponse.json({ walk });
}
