import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { getWalkInfrastructure } from "@/lib/walk-infra";
import { checkWalkInfraRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * GET /api/walk/nearby?lat&lng[&coords=1][&nodes=1] - 내 주변 보행 인프라(음향신호기+OSM 횡단보도·점자블록).
 * `coords=1`은 나들이 옵트인(spec 2026-09-26 §6.3): 음향신호기 지점에 좌표를 싣고 횡단보도·지점 상한을
 * 넓힌다. `nodes=1`은 나들이 교차로·횡단보도 원천 옵트인(§6.6): `osmJunctions`·`seoulNetwork`를 더한다.
 * 둘 다 미지정이면 종전 응답과 같다(채팅·CLI·내 주변 보행 섹션·스토어 앱).
 *
 * 서비스 계층 getWalkInfrastructure만 호출한다(provider 직접 호출 금지, spec §1).
 * 실린 원천이 모두 error일 때만 503으로 판정하고(옵트인이 아니면 두 소스), 한 소스만 실패해도 200으로 부분
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
  coords: z.enum(["1"]).optional(),
  nodes: z.enum(["1"]).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    coords: request.nextUrl.searchParams.get("coords") ?? undefined,
    nodes: request.nextUrl.searchParams.get("nodes") ?? undefined,
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

  const walk = await getWalkInfrastructure(parsed.data.lat, parsed.data.lng, {
    coords: parsed.data.coords === "1",
    nodes: parsed.data.nodes === "1",
  });
  // 실린 원천이 모두 error일 때만 503(노드 옵트인의 두 원천이 살아 있으면 부분 결과다).
  const sources = [walk.audioSignals, walk.osm, walk.osmJunctions, walk.seoulNetwork].filter((x) => x !== undefined);
  if (sources.every((x) => x.status === "error")) {
    return NextResponse.json(
      { error: "보행 인프라 정보 조회에 실패했습니다." },
      { status: 503 },
    );
  }
  return NextResponse.json({ walk });
}
