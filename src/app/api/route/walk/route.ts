import { NextRequest, NextResponse } from "next/server";
import { hasWalkRouteKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { checkWalkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getWalkRoute, getWalkRouteAlternatives } from "@/lib/walk-route";
import { parseWalkQuery } from "./route-schema";
import { buildGuideRoute } from "@/lib/route-geometry";
import { computeFinalApproach } from "@/lib/final-approach";
import type { Coord, WalkRouteBriefing } from "@/lib/types";

/**
 * 도보 길찾기 프록시(기본 카카오·폴백 Tmap). 좌표는 "위도,경도" 순서(도메인 표준, transit route와 동형).
 *
 * 3-state 응답: 입력 오류(400) · 한국 밖(200 outOfCoverage 마커) · 키 없음(404, 게이트) ·
 * 조회 실패(502)를 뭉개지 않는다.
 * 두 provider 모두 유료 API라 채팅과 동일한 IP 레이트리밋(60초 10회)으로
 * 호출 *전*에 비용을 방어한다.
 */

/**
 * 종점 오프셋 기하를 **요청받은 원좌표로** 계산해 부착한다(spec 2026-08-08 §3.1).
 *
 * ⚠ provider 응답에 넣지 않는 이유: provider URL이 `roundCoord(…,4)`(±5.5m)로 반올림한
 * 목적지를 쓰므로 같은 셀의 다른 목적지가 캐시 엔트리를 공유한다. 거기에 방향을 실으면
 * 옆 건물 기준 방향이 그대로 낭독된다. 지금은 `includeGeometry`가 upstream fetch를
 * `no-store`로 만들지만, 그 사실에 의존하지 않는다 — 캐시 정책이 바뀌어도 이 계층은 옳다.
 *
 * 마지막 스텝 설명에서 도로명을 뽑지 않는다(파싱 규칙이 provider 문장에 종속된다).
 * `roadName`은 별도 계층이 정하며, 없으면 문장에서 기준절을 뺀다 — 지어내지 않는다.
 */
function withFinalApproach(
  briefing: WalkRouteBriefing | null,
  dest: Coord,
  includeGeometry: boolean,
): WalkRouteBriefing | null {
  if (!briefing || !includeGeometry) return briefing;
  const guide = buildGuideRoute(
    briefing.steps.map((s) => ({
      description: s.description,
      pathCoords: s.pathCoords,
    })),
  );
  if (!guide) return briefing;
  const finalApproach = computeFinalApproach(guide, dest);
  return finalApproach ? { ...briefing, finalApproach } : briefing;
}

export async function GET(request: NextRequest) {
  const parsed = parseWalkQuery({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
    accessible: request.nextUrl.searchParams.get("accessible"),
    includeGeometry: request.nextUrl.searchParams.get("includeGeometry"),
    variant: request.nextUrl.searchParams.get("variant"),
    alternatives: request.nextUrl.searchParams.get("alternatives"),
    via: request.nextUrl.searchParams.get("via"),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
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
    if (parsed.data.alternatives) {
      // 추천+최단 병렬(M3). 기하 없음 — withFinalApproach 미적용(조회 화면 전용).
      // 부분 성공 비대칭: 기본 실패는 catch로 떨어져 502, 최단 실패만 null 흡수.
      const { result, ...rest } = await getWalkRouteAlternatives({
        origin,
        dest,
        accessible: parsed.data.accessible,
      });
      return NextResponse.json({ result, ...("shortest" in rest ? { shortest: rest.shortest } : {}) });
    }
    const result = await getWalkRoute({
      origin,
      dest,
      accessible: parsed.data.accessible,
      includeGeometry: parsed.data.includeGeometry,
      variant: parsed.data.variant,
    });
    return NextResponse.json({
      result: withFinalApproach(result, dest, parsed.data.includeGeometry),
    });
  } catch (e) {
    console.error("[api/route/walk] 도보 길찾기 실패:", e);
    return NextResponse.json(
      { error: "도보 길찾기에 실패했습니다." },
      { status: 502 },
    );
  }
}
